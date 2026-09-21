import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Response } from "express";
import { ZodError } from "zod";

/** Every error leaves the API as `{ error: <code>, details?, message? }` with a proper HTTP status. */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger("HTTP");
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const status = exception.getStatus();
      if (typeof body === "object" && body && "error" in body) return res.status(status).json(body);
      const code = status === 401 ? "invalid_token" : status === 403 ? "forbidden" : status === 404 ? "not_found" : status === 429 ? "rate_limited" : status === 400 ? "validation" : "internal";
      const message = typeof body === "string" ? body : (body as { message?: unknown }).message;
      return res.status(status).json({ error: code, ...(message ? { message } : {}) });
    }
    if (exception instanceof ZodError) {
      return res.status(HttpStatus.BAD_REQUEST).json({ error: "validation", details: { issues: exception.issues } });
    }
    this.log.error(exception instanceof Error ? exception.stack : String(exception));
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: "internal" });
  }
}
