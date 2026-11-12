import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import { ErrorCode, ProblemDetail } from '@dineflow/contracts';

/**
 * Global exception filter that maps all errors to RFC 7807 problem+json.
 * Never leaks stack traces or internal IDs in production.
 * Reference: ARCH §13, AGENTS §2 rule 13
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const requestId = (request.headers['x-request-id'] as string) ?? 'unknown';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let problem: ProblemDetail;

    if (exception instanceof ZodValidationException || exception instanceof ZodError) {
      status = HttpStatus.UNPROCESSABLE_ENTITY;
      const zodErr =
        exception instanceof ZodValidationException
          ? exception.getZodError()
          : exception;
      const errors = zodErr.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      }));
      problem = {
        title: 'Validation Error',
        status,
        code: ErrorCode.VALIDATION_ERROR,
        detail: 'One or more request fields failed validation.',
        requestId,
        errors,
      };
    } else if (this.isDomainError(exception)) {
      // Service threw a typed DomainError — map directly to RFC 7807
      status = exception.status;
      problem = {
        title: exception.message,
        status,
        code: exception.code,
        detail: exception.message,
        requestId,
      ...(exception.details ? { errors: [exception.details as { path: string; message: string }] } : {}),
      };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      const code = this.toErrorCode(status);
      problem = {
        title: exception.message,
        status,
        code,
        detail: typeof response === 'string' ? response : undefined,
        requestId,
      };
    } else {
      // Unknown error — log full detail but never return it
      this.logger.error({ requestId, err: exception }, 'Unhandled exception');
      problem = {
        title: 'Internal Server Error',
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: ErrorCode.INTERNAL_ERROR,
        requestId,
      };
    }

    void reply
      .status(status)
      .header('Content-Type', 'application/problem+json')
      .send(problem);
  }

  private isDomainError(err: unknown): err is { code: ErrorCode; message: string; status: number; details?: Record<string, unknown> } {
    return (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      'message' in err &&
      'status' in err &&
      typeof (err as { status: unknown }).status === 'number'
    );
  }

  private toErrorCode(status: number): ErrorCode {
    switch (status) {
      case 400: return ErrorCode.VALIDATION_ERROR;
      case 401: return ErrorCode.UNAUTHORIZED;
      case 403: return ErrorCode.FORBIDDEN;
      case 404: return ErrorCode.NOT_FOUND;
      case 409: return ErrorCode.CONFLICT;
      case 422: return ErrorCode.UNPROCESSABLE;
      case 429: return ErrorCode.RATE_LIMITED;
      default:  return ErrorCode.INTERNAL_ERROR;
    }
  }
}
