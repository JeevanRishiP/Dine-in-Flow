import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';
import pino from 'pino';
import { AppModule } from './app.module.js';
import { getConfig } from './config/config.js';
import { getRedis } from './common/redis/redis.client.js';

const MAX_WEBHOOK_BYTES = 1_048_576; // 1 MiB cap for webhook raw payloads
const RATE_LIMIT_WINDOW_SEC = 60;
const AUTH_RPM_LIMIT = 40;
const GENERAL_RPM_LIMIT = 300;

async function bootstrap(): Promise<void> {
  const config = getConfig();

  // Pino logger with centralized PII redaction
  // ARCH §4: "pino with request id; no PII"
  const logger = pino({
    level: config.NODE_ENV === 'production' ? 'info' : 'debug',
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'body.password',
        'body.otp',
        'body.token',
        'body.refreshToken',
        'body.phone',
        'body.email',
        'body.phone_e164',
      ],
      censor: '[REDACTED]',
    },
    serializers: {
      req(req: { id: string; method: string; url: string }) {
        return {
          id: req.id,
          method: req.method,
          url: req.url,
        };
      },
    },
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: false, // We use pino directly below
      trustProxy: config.TRUST_PROXY,
      bodyLimit: MAX_WEBHOOK_BYTES,
    }),
  );

  // Global validation pipe via nestjs-zod
  app.useGlobalPipes(new ZodValidationPipe());

  const corsOrigins =
    config.NODE_ENV === 'production'
      ? (config.ALLOWED_CORS_ORIGINS ?? 'https://app.dineflow.in,https://console.dineflow.in')
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean)
      : true;

  // CORS — explicit allowlist in production
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key', 'X-Org-Id'],
  });

  // Security headers + distributed Redis rate limiting + bounded rawBody webhook capture
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Fastify instance hooks
  const fastifyInstance = app.getHttpAdapter().getInstance() as any;

  fastifyInstance.addHook(
    'onSend',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Fastify onSend signature
    (_req: any, reply: any, payload: any, done: any) => {
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('X-Frame-Options', 'DENY');
      reply.header('Referrer-Policy', 'no-referrer');
      reply.header('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
      reply.header('X-DNS-Prefetch-Control', 'off');
      if (config.NODE_ENV === 'production') {
        reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      }
      done(null, payload);
    },
  );

  fastifyInstance.addHook(
    'onRequest',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Fastify onRequest signature
    async (req: any, reply: any) => {
      const url = typeof req.url === 'string' ? req.url : '';
      if (url === '/healthz' || url === '/readyz') return;

      const isAuthOrSession =
        url.startsWith('/v1/auth/') || url.startsWith('/v1/public/sessions/open');
      const limit = isAuthOrSession ? AUTH_RPM_LIMIT : GENERAL_RPM_LIMIT;
      const bucket = isAuthOrSession ? 'auth' : 'api';
      const ip = String(req.ip || 'unknown');

      try {
        const redis = getRedis();
        const key = `rl:${bucket}:${ip}`;
        const count = await redis.incr(key);
        if (count === 1) {
          await redis.expire(key, RATE_LIMIT_WINDOW_SEC);
        }
        reply.header('X-RateLimit-Limit', String(limit));
        reply.header('X-RateLimit-Remaining', String(Math.max(0, limit - count)));
        if (count > limit) {
          reply.code(429).header('Content-Type', 'application/problem+json').send({
            title: 'Too many requests',
            status: 429,
            code: 'RATE_LIMITED',
            detail: 'Rate limit exceeded. Please slow down and try again shortly.',
          });
          return reply;
        }
      } catch {
        // Fail open if Redis restarts transiently so healthy requests are not dropped
      }
    },
  );

  // OpenAPI — only in non-production
  if (config.OPENAPI_ENABLED || config.NODE_ENV !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('DineFlow API')
      .setDescription('Multi-tenant restaurant dine-in ordering SaaS')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('v1/docs', app, document);
    logger.info('[BOOT] OpenAPI docs available at /v1/docs');
  }

  // ── Raw body for webhook signature verification (bounded to MAX_WEBHOOK_BYTES) ──
  // Reference: AGENTS §2 rule 9, ARCH §11
  fastifyInstance.addHook(
    'preParsing',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw Fastify hook signature
    (req: any, _reply: any, payload: any, done: any) => {
      if (typeof req.url === 'string' && req.url.includes('/webhooks/')) {
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        payload.on('data', (chunk: Buffer) => {
          totalBytes += chunk.length;
          if (totalBytes <= MAX_WEBHOOK_BYTES) {
            chunks.push(chunk);
          }
        });
        payload.on('end', () => {
          if (totalBytes <= MAX_WEBHOOK_BYTES) {
            req.rawBody = Buffer.concat(chunks);
          }
        });
      }
      done(null, payload);
    },
  );

  // API versioning prefix
  app.setGlobalPrefix('v1', { exclude: ['healthz', 'readyz'] });

  // Graceful shutdown
  app.enableShutdownHooks();

  await app.listen(config.PORT, '0.0.0.0');
  logger.info({ port: config.PORT, env: config.NODE_ENV }, '[BOOT] DineFlow API started');
}

bootstrap().catch((err: unknown) => {
  console.error('[FATAL] Bootstrap failed', err);
  process.exit(1);
});

