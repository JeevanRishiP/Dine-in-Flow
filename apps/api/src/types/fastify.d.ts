/**
 * Extends the Fastify types to include rawBody.
 * This is set by the preParsing hook in main.ts for /webhooks/* routes.
 * Reference: ARCH §11 (webhook raw body requirement)
 */

import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}
