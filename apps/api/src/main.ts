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
    new FastifyAdapter({ logger: false }), // We use pino directly below
  );

  // Global validation pipe via nestjs-zod
  app.useGlobalPipes(new ZodValidationPipe());

  // TODO Phase 11: add @fastify/helmet for CSP/HSTS headers at the Fastify layer

  // CORS — explicit allowlist in production
  app.enableCors({
    origin:
      config.NODE_ENV === 'production'
        ? ['https://app.dineflow.in', 'https://console.dineflow.in']
        : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key'],
  });

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

  // ── Raw body for webhook signature verification ─────────────────────────────
  // PhonePe and Razorpay MUST verify the signature on the raw body Buffer.
  // Store rawBody on requests targeting /webhooks/* before Fastify parses them.
  // Reference: AGENTS §2 rule 9, ARCH §11
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Fastify instance: bypass generic hell for preParsing hook
  const fastifyInstance = app.getHttpAdapter().getInstance() as any;
  fastifyInstance.addHook(
    'preParsing',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw Fastify hook signature
    (req: any, _reply: any, payload: any, done: any) => {
      if (typeof req.url === 'string' && req.url.includes('/webhooks/')) {
        const chunks: Buffer[] = [];
        payload.on('data', (chunk: Buffer) => chunks.push(chunk));
        payload.on('end', () => { req.rawBody = Buffer.concat(chunks); });
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

