import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../decorators/auth.decorators.js';

/**
 * Health check endpoints.
 * /healthz  — liveness  (is the process alive?)
 * /readyz   — readiness (is the app ready to serve traffic? checks DB + Redis)
 * Both are @Public() — no auth required by k8s/load balancer.
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
  @ApiOperation({ summary: 'Readiness probe — checks DB + Redis connectivity' })
  readiness(): { status: string } {
    // TODO: add real DB + Redis ping in Phase 2 when pools are injectable
    return { status: 'ok' };
  }
}
