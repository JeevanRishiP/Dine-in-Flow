import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';

function loadLocalEnvIfPresent() {
  const candidates = [
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../../.env.local'),
    path.resolve(process.cwd(), '../../.env'),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim();
          if (process.env[key] === undefined || process.env[key] === '') {
            process.env[key] = val;
          }
        }
      }
    }
  }
}

loadLocalEnvIfPresent();

/**
 * Zod-validated environment config.
 * The process crashes at boot if any required var is missing/invalid.
 * Reference: ARCH §5, AGENTS §2 rule 5
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),

    // Database
    DATABASE_URL: z
      .string()
      .url()
      .startsWith('postgresql://')
      .describe('Postgres connection string for the app role (no BYPASSRLS)'),
    DATABASE_MIGRATOR_URL: z
      .string()
      .url()
      .startsWith('postgresql://')
      .optional()
      .describe('Used only by migration runner (privileged role)'),

    // Redis
    REDIS_URL: z.string().url().startsWith('redis://').describe('Redis connection string'),

    // App secrets
    JWT_SECRET: z.string().min(32).describe('HS256 JWT signing secret (≥32 chars)'),
    OTP_HMAC_PEPPER: z.string().min(32).describe('HMAC pepper for OTP hashing (≥32 chars)'),
    QR_TOKEN_SECRET: z.string().min(32).describe('HMAC secret for QR token signing (≥32 chars)'),

    // S3/MinIO
    S3_ENDPOINT: z.string().url().default('http://localhost:9000'),
    S3_REGION: z.string().default('ap-south-1'),
    S3_ACCESS_KEY: z.string().default('minioadmin'),
    S3_SECRET_KEY: z.string().default('minioadmin'),
    S3_RAW_BUCKET: z.string().min(1).default('dineflow-raw'),
    S3_PROCESSED_BUCKET: z.string().min(1).default('dineflow-processed'),

    // Feature flags
    OPENAPI_ENABLED: z.coerce.boolean().default(false),

    // ── Payment Gateways ──────────────────────────────────────────────────────
    // PhonePe (UPI payments) — Sandbox by default in development
    PHONEPE_CLIENT_ID:         z.string().min(1).optional().default('PGTESTPAYUAT86'),
    PHONEPE_CLIENT_SECRET:     z.string().min(1).optional().default('96434309-7796-489d-8924-ab56988a6076'),
    PHONEPE_CLIENT_VERSION:    z.coerce.number().int().positive().default(1),
    PHONEPE_ENV:               z.enum(['SANDBOX', 'PRODUCTION']).default('SANDBOX'),
    PHONEPE_WEBHOOK_USERNAME:  z.string().min(1).optional().default('phonepe_webhook_user'),
    PHONEPE_WEBHOOK_PASSWORD:  z.string().min(1).optional().default('phonepe_webhook_pass'),
    WEBHOOK_PUBLIC_URL:        z.string().optional().default('https://titled-north-aware-praise.trycloudflare.com'),

    // Razorpay (Card / NetBanking / Wallet payments) — Sandbox by default
    RAZORPAY_KEY_ID:           z.string().min(1).optional().default('rzp_test_PLACEHOLDER'),
    RAZORPAY_KEY_SECRET:       z.string().min(1).optional().default('PLACEHOLDER_SECRET'),
    RAZORPAY_WEBHOOK_SECRET:   z.string().min(1).optional().default('razorpay_webhook_secret'),

    // App public base URL (used to build returnUrl / webhook URLs)
    APP_BASE_URL: z.string().url().default('http://localhost:3000'),

    // ── AI Assistant (Gemini) ────────────────────────────────────────────────
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL:   z.string().default('gemini-3.5-flash-lite'),
  })
  .passthrough();


export type AppConfig = z.infer<typeof envSchema>;

let _config: AppConfig | undefined;

/**
 * Parse and cache the config at module load time.
 * Throws a detailed ZodError (not caught) so the process exits on startup with a clear message.
 */
export function getConfig(): AppConfig {
  if (_config) return _config;

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    // Print readable error and crash — per ARCH §5 "the process must crash on invalid config"
    console.error('[CONFIG] Invalid environment variables:');
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }

  _config = result.data;
  return _config;
}
