import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import { APP_CONFIG } from "@/config/config.module";
import type { AppConfig } from "@/config/config.schema";
import { AppError } from "@/common/errors/app-error";
import type { Claims } from "./claims";
import { ALLOW_FPC, IS_PUBLIC, PERMS, ROLES } from "./decorators";

function meta<T>(reflector: Reflector, key: string, ctx: ExecutionContext): T | undefined {
  return reflector.getAllAndOverride<T>(key, [ctx.getHandler(), ctx.getClass()]);
}

/** Global: verifies the bearer token and attaches claims to req.user. `@Public()` opts out. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private reflector: Reflector, private jwt: JwtService, @Inject(APP_CONFIG) private cfg: AppConfig) {}
  async canActivate(ctx: ExecutionContext) {
    if (meta<boolean>(this.reflector, IS_PUBLIC, ctx)) return true;
    const req = ctx.switchToHttp().getRequest<Request & { user?: Claims }>();
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : (req.query?.access_token as string | undefined);
    if (!token) throw new AppError("invalid_token");
    try {
      req.user = await this.jwt.verifyAsync<Claims>(token, { secret: this.cfg.JWT_ACCESS_SECRET });
    } catch {
      throw new AppError("invalid_token");
    }
    return true;
  }
}

/** Global: while force_password_change is set, only handlers marked @AllowForcePasswordChange() are reachable. */
@Injectable()
export class ForcePasswordChangeGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(ctx: ExecutionContext) {
    if (meta<boolean>(this.reflector, IS_PUBLIC, ctx)) return true;
    const user = ctx.switchToHttp().getRequest().user as Claims | undefined;
    if (user?.fpc && !meta<boolean>(this.reflector, ALLOW_FPC, ctx)) throw new AppError("force_password_change");
    return true;
  }
}

/** Global: enforces @Roles() and @Perms(). super_admin bypasses both. */
@Injectable()
export class RolesPermsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(ctx: ExecutionContext) {
    if (meta<boolean>(this.reflector, IS_PUBLIC, ctx)) return true;
    const roles = meta<string[]>(this.reflector, ROLES, ctx);
    const perms = meta<string[]>(this.reflector, PERMS, ctx);
    if (!roles?.length && !perms?.length) return true;
    const user = ctx.switchToHttp().getRequest().user as Claims | undefined;
    if (!user) throw new AppError("invalid_token");
    if (user.super) return true;
    if (roles?.length && !roles.some((r) => user.roles.includes(r as Claims["roles"][number]))) throw new AppError("forbidden", { need: roles });
    if (perms?.length && !perms.some((p) => user.perms.includes(p))) throw new AppError("forbidden", { need: perms });
    return true;
  }
}

/** For /merchant/* handlers: the caller must own an active store; its id is used instead of anything in the body. */
export function requireStore(user: Claims): string {
  if (!user.store_id) throw new AppError("forbidden", { reason: "no_store" });
  return user.store_id;
}
