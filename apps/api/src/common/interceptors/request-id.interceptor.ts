import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { Observable } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';

/**
 * Attaches a unique request-id to every incoming request.
 * Uses the client-supplied X-Request-Id header if present, otherwise generates a UUID v4.
 * The id is exposed in the response header for correlation.
 * Reference: ARCH §13, AGENTS §2 rule 7 (no PII in logs)
 */
@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse();

    const requestId =
      (req.headers['x-request-id'] as string | undefined) ?? uuidv4();

    req.headers['x-request-id'] = requestId;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    reply.header('x-request-id', requestId);

    return next.handle();
  }
}
