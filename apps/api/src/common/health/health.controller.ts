import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../decorators/auth.decorators.js';
import { getPool } from '../../db/client.js';

/**
 * Health check endpoints.
 * /healthz        — liveness (is the process alive?)
 * /readyz         — readiness (is the app ready to serve traffic?)
 * /health         — public health & DB connectivity check (accessible as /api/v1/health or /v1/health)
 * All are @Public() — no auth required by load balancers, orchestrators, or monitors.
 * Reference: ARCH §13
 */
@ApiTags('health')
@Controller()
@Public()
export class HealthController {
  @Get('healthz')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness probe' })
  liveness(): { status: string } {
    return { status: 'ok' };
  }

  @Get('readyz')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Readiness probe' })
  async readiness(): Promise<{ status: string; db: string }> {
    try {
      const pool = getPool();
      await pool.query('SELECT 1');
      return { status: 'ok', db: 'connected' };
    } catch {
      return { status: 'degraded', db: 'disconnected' };
    }
  }

  @Get(['health', 'api/v1/health'])
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Public health probe with PostgreSQL connectivity verification' })
  async health(): Promise<{ status: string; db: string; timestamp: string }> {
    try {
      const pool = getPool();
      await pool.query('SELECT 1');
      return {
        status: 'ok',
        db: 'connected',
        timestamp: new Date().toISOString(),
      };
    } catch {
      return {
        status: 'degraded',
        db: 'disconnected',
        timestamp: new Date().toISOString(),
      };
    }
  }
}
