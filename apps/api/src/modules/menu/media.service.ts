import { Injectable, Logger } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getConfig } from '../../config/config.js';
import { withTenantContext } from '../../db/client.js';
import { domainError } from '../../common/errors/domain-error.js';
import { ErrorCode } from '@dineflow/contracts';
import crypto from 'node:crypto';

/** Allowed content types for image uploads */
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/avif',
]);

/** Max raw upload size: 20 MB */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** VideoProvider interface — swap in Cloudflare Stream / Mux in Phase 2+ */
export interface VideoProvider {
  createUpload(orgId: string, itemId: string): Promise<{ upload_url: string; video_id: string }>;
}

@Injectable()
export class MockVideoProvider implements VideoProvider {
  private readonly logger = new Logger('MockVideoProvider');
  async createUpload(orgId: string, itemId: string) {
    this.logger.log(`[MOCK] Video upload requested for item ${itemId} in org ${orgId}`);
    return {
      upload_url: `https://mock-video-provider.local/upload/${crypto.randomUUID()}`,
      video_id: crypto.randomUUID(),
    };
  }
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger('MediaService');
  private s3: S3Client;

  constructor(private readonly videoProvider: VideoProvider) {
    const cfg = getConfig();
    this.s3 = new S3Client({
      endpoint: cfg.S3_ENDPOINT,
      region: cfg.S3_REGION,
      credentials: {
        accessKeyId: cfg.S3_ACCESS_KEY,
        secretAccessKey: cfg.S3_SECRET_KEY,
      },
      forcePathStyle: true, // required for MinIO
    });
  }

  /**
   * Generate a presigned PUT URL for direct client-to-S3 upload.
   * Reference: ARCH §22
   */
  async getPresignedUploadUrl(
    orgId: string,
    itemId: string,
    contentType: string,
    mediaType: 'IMAGE' | 'VIDEO',
    actorId: string,
  ): Promise<{ upload_url: string; media_id: string; expires_in: number }> {
    if (mediaType === 'IMAGE' && !ALLOWED_IMAGE_TYPES.has(contentType)) {
      throw domainError(
        ErrorCode.VALIDATION_ERROR,
        `Content type ${contentType} not allowed. Accepted: ${[...ALLOWED_IMAGE_TYPES].join(', ')}`,
        422,
      );
    }

    if (mediaType === 'VIDEO') {
      const { upload_url, video_id } = await this.videoProvider.createUpload(orgId, itemId);
      const mediaId = await this._createMediaRow(orgId, itemId, `video/${video_id}`, mediaType, contentType, actorId);
      return { upload_url, media_id: mediaId, expires_in: 3600 };
    }

    const cfg = getConfig();
    const rawKey = `raw/${orgId}/${itemId}/${crypto.randomUUID()}`;
    const command = new PutObjectCommand({
      Bucket: cfg.S3_RAW_BUCKET,
      Key: rawKey,
      ContentType: contentType,
      Metadata: {
        'x-org-id': orgId,
        'x-item-id': itemId,
        'x-actor-id': actorId,
      },
    });

    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: 900 });
    const mediaId = await this._createMediaRow(orgId, itemId, rawKey, mediaType, contentType, actorId);
    return { upload_url: uploadUrl, media_id: mediaId, expires_in: 900 };
  }

  /**
   * Process an uploaded image: validate, re-encode to WebP, strip EXIF.
   * Called by an async job on S3 event notification.
   */
  async processImage(orgId: string, mediaId: string, rawKey: string): Promise<void> {
    this.logger.log(`Processing image media=${mediaId} key=${rawKey}`);
    await this._setMediaStatus(orgId, mediaId, 'PROCESSING');

    try {
      const cfg = getConfig();

      // Download raw from S3
      const raw = await this.s3.send(new GetObjectCommand({ Bucket: cfg.S3_RAW_BUCKET, Key: rawKey }));
      const chunks: Buffer[] = [];
      for await (const chunk of raw.Body as AsyncIterable<Buffer>) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      if (buffer.byteLength > MAX_UPLOAD_BYTES) {
        throw domainError(ErrorCode.VALIDATION_ERROR, 'Upload exceeds 20 MB', 422);
      }

      // Polyglot / magic-byte check — ARCH §22 threat model
      this._validateImageMagicBytes(buffer);

      // Re-encode with sharp (EXIF stripped automatically by sharp)
      const sharp = (await import('sharp')).default;
      const image = sharp(buffer).rotate();

      const [webpBuffer, thumbBuffer] = await Promise.all([
        image.clone().webp({ quality: 85 }).toBuffer(),
        image.clone().resize(400, 400, { fit: 'inside' }).webp({ quality: 70 }).toBuffer(),
      ]);

      const baseKey = rawKey.replace(/^raw\//, 'processed/');
      const processedKey = `${baseKey}.webp`;
      const thumbnailKey = `${baseKey}_thumb.webp`;

      await Promise.all([
        this.s3.send(new PutObjectCommand({
          Bucket: cfg.S3_PROCESSED_BUCKET,
          Key: processedKey,
          Body: webpBuffer,
          ContentType: 'image/webp',
          CacheControl: 'public, max-age=31536000, immutable',
        })),
        this.s3.send(new PutObjectCommand({
          Bucket: cfg.S3_PROCESSED_BUCKET,
          Key: thumbnailKey,
          Body: thumbBuffer,
          ContentType: 'image/webp',
          CacheControl: 'public, max-age=31536000, immutable',
        })),
      ]);

      await withTenantContext(orgId, async (db) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- drizzle wraps pg client
        const client = (db as any).session?.client ?? (db as any);
        await client.query(
          `UPDATE item_media
           SET status = 'READY', processed_key = $2, thumbnail_key = $3,
               size_bytes = $4, updated_at = now()
           WHERE id = $1`,
          [mediaId, processedKey, thumbnailKey, buffer.byteLength],
        );
      });

      this.logger.log(`Image processed: media=${mediaId}`);
    } catch (err) {
      this.logger.error(`Image processing failed for media=${mediaId}`, err);
      await this._setMediaStatus(orgId, mediaId, 'FAILED');
      throw err;
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private async _createMediaRow(
    orgId: string, itemId: string, rawKey: string,
    mediaType: 'IMAGE' | 'VIDEO', mimeType: string, _actorId: string,
  ): Promise<string> {
    return withTenantContext(orgId, async (db) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- drizzle wraps pg client
      const client = (db as any).session?.client ?? (db as any);
      const { rows } = await client.query(
        `INSERT INTO item_media (org_id, item_id, raw_key, media_type, mime_type, status)
         VALUES ($1, $2, $3, $4, $5, 'PENDING')
         RETURNING id`,
        [orgId, itemId, rawKey, mediaType, mimeType],
      );
      return (rows[0] as { id: string }).id;
    });
  }

  private async _setMediaStatus(orgId: string, mediaId: string, status: string) {
    await withTenantContext(orgId, async (db) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- drizzle wraps pg client
      const client = (db as any).session?.client ?? (db as any);
      await client.query(
        `UPDATE item_media SET status = $2, updated_at = now() WHERE id = $1`,
        [mediaId, status],
      );
    });
  }

  /** Validate magic bytes to prevent polyglot file attacks. Reference: ARCH §22 */
  private _validateImageMagicBytes(buf: Buffer): void {
    const jpeg = buf[0] === 0xff && buf[1] === 0xd8;
    const png  = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const webp = buf.length > 11 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
    const avif = buf.length > 7  && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70;
    if (!jpeg && !png && !webp && !avif) {
      throw domainError(
        ErrorCode.VALIDATION_ERROR,
        'File content does not match an allowed image format',
        422,
      );
    }
  }
}
