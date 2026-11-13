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

if (process.env['NODE_ENV'] !== 'production') {
  loadLocalEnvIfPresent();
}

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
    ALLOWED_CORS_ORIGINS: z.string().optional(),
    TRUST_PROXY: z.coerce.boolean().default(true),

    // ── AI Assistant (Gemini) ────────────────────────────────────────────────
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL:   z.string().default('gemini-3.5-flash-lite'),

    // ── Google OAuth & WhatsApp OTP Delivery ─────────────────────────────────
    GOOGLE_CLIENT_ID:        z.string().optional(),
    DEFAULT_PUBLIC_OUTLET_ID: z.string().uuid().optional(),
    WHATSAPP_PROVIDER:       z.enum(['mock', 'meta', 'evolution_dev']).default('mock'),
    EVOLUTION_API_URL:       z.string().url().optional(),
    EVOLUTION_API_KEY:       z.string().optional(),
    EVOLUTION_INSTANCE_NAME: z.string().min(1).default('dineflow_otp'),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_ACCESS_TOKEN:   z.string().optional(),
  })
  .passthrough()
  .superRefine((cfg, ctx) => {
    if (cfg.NODE_ENV !== 'production') return;

    const addIssue = (path: string, message: string) => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    };

    if (cfg.WHATSAPP_PROVIDER === 'evolution_dev') {
      addIssue('WHATSAPP_PROVIDER', 'WHATSAPP_PROVIDER=evolution_dev is strictly forbidden in production (ADR 0002)');
    }

    if (/^postgres(ql)?:\/\/postgres:/i.test(cfg.DATABASE_URL)) {
      addIssue('DATABASE_URL', 'Production DATABASE_URL must not use superuser postgres credentials');
    }
    if (cfg.PHONEPE_ENV === 'SANDBOX') {
      addIssue('PHONEPE_ENV', 'PHONEPE_ENV must be PRODUCTION in production');
    }
    if (cfg.PHONEPE_CLIENT_ID === 'PGTESTPAYUAT86') {
      addIssue('PHONEPE_CLIENT_ID', 'Sandbox PHONEPE_CLIENT_ID is forbidden in production');
    }
    if (cfg.PHONEPE_CLIENT_SECRET === '96434309-7796-489d-8924-ab56988a6076') {
      addIssue('PHONEPE_CLIENT_SECRET', 'Default PHONEPE_CLIENT_SECRET is forbidden in production');
    }
    if (cfg.PHONEPE_WEBHOOK_PASSWORD === 'phonepe_webhook_pass') {
      addIssue('PHONEPE_WEBHOOK_PASSWORD', 'Default PHONEPE_WEBHOOK_PASSWORD is forbidden in production');
    }
    if (cfg.RAZORPAY_KEY_ID === 'rzp_test_PLACEHOLDER' || cfg.RAZORPAY_KEY_SECRET === 'PLACEHOLDER_SECRET') {
      addIssue('RAZORPAY_KEY_ID', 'Placeholder Razorpay credentials are forbidden in production');
    }
    if (cfg.RAZORPAY_WEBHOOK_SECRET === 'razorpay_webhook_secret') {
      addIssue('RAZORPAY_WEBHOOK_SECRET', 'Default RAZORPAY_WEBHOOK_SECRET is forbidden in production');
    }
    if (cfg.S3_ACCESS_KEY === 'minioadmin' || cfg.S3_SECRET_KEY === 'minioadmin') {
      addIssue('S3_ACCESS_KEY', 'Default MinIO dev credentials are forbidden in production');
    }
    if (cfg.WEBHOOK_PUBLIC_URL.includes('trycloudflare.com')) {
      addIssue('WEBHOOK_PUBLIC_URL', 'Ephemeral trycloudflare tunnel URL is forbidden in production');
    }
    if (!process.env['GBP_TOKEN_ENCRYPTION_KEY'] || process.env['GBP_TOKEN_ENCRYPTION_KEY'].length < 32) {
      addIssue('GBP_TOKEN_ENCRYPTION_KEY', 'GBP_TOKEN_ENCRYPTION_KEY (>=32 chars) is required in production');
    }
  });


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
