import { createParamDecorator, ExecutionContext, SetMetadata } from "@nestjs/common";
import type { Claims, AppRole } from "./claims";

export const IS_PUBLIC = "isPublic";
export const ROLES = "roles";
export const PERMS = "perms";
export const ALLOW_FPC = "allowForcePasswordChange";

/** Skip JWT authentication for this handler. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Caller must hold at least one of these roles (super_admin always passes). */
export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES, roles);
/** Caller must hold at least one of these admin permissions (super_admin always passes). */
export const Perms = (...perms: string[]) => SetMetadata(PERMS, perms);
/** Reachable while the user still has to change their password. */
export const AllowForcePasswordChange = () => SetMetadata(ALLOW_FPC, true);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): Claims => {
  return ctx.switchToHttp().getRequest().user as Claims;
});
