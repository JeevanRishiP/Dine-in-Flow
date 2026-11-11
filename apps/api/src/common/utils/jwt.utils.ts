/**
 * Standalone JWT verification utility (no NestJS DI required).
 * Used by the KDS WebSocket gateway which runs outside the request cycle.
 *
 * Uses the same underlying library as TokenService (jsonwebtoken via @nestjs/jwt).
 * Reference: ARCH §12
 */

import jwt from 'jsonwebtoken';
import type { JwtPayload } from '../../modules/auth/token.service.js';

export function verifyJwt(token: string, secret: string): JwtPayload | null {
  try {
    return jwt.verify(token, secret) as JwtPayload;
  } catch {
    return null;
  }
}
