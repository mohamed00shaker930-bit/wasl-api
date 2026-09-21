import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { APP_CONFIG } from "@/config/config.module";
import type { AppConfig } from "@/config/config.schema";
import { AllowForcePasswordChange, CurrentUser, Public, type Claims } from "@/common/auth";
import { AuthService, type RequestMeta, type TokenPair } from "./auth.service";
import { TokensService, type ClientKind } from "./tokens.service";
import { ChangePasswordDto, LoginDto, PasswordResetRequestDto, RefreshDto, RegisterDto } from "./dto";

export const REFRESH_COOKIE = "wasl_refresh";

function clientKind(req: Request): ClientKind {
  return (req.headers["x-client"] as string | undefined)?.toLowerCase() === "mobile" ? "mobile" : "web";
}
function metaOf(req: Request): RequestMeta {
  return { client: clientKind(req), userAgent: req.headers["user-agent"], ip: (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? undefined };
}

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private auth: AuthService, private tokens: TokensService, @Inject(APP_CONFIG) private cfg: AppConfig) {}

  /** Web clients get the refresh token as an httpOnly cookie scoped to /api/auth; mobile clients get it in the body. */
  private respond(req: Request, res: Response, pair: TokenPair) {
    const { refresh_token, claims, ...rest } = pair;
    if (clientKind(req) === "web") {
      res.cookie(REFRESH_COOKIE, refresh_token, { httpOnly: true, sameSite: "strict", secure: this.cfg.COOKIE_SECURE, path: "/api/auth", maxAge: this.tokens.refreshTtlMs });
      return { ...rest, user: { id: claims.sub, phone: claims.phone, roles: claims.roles, super: claims.super, is_staff: claims.staff, store_id: claims.store_id, force_password_change: claims.fpc } };
    }
    return { ...rest, refresh_token, user: { id: claims.sub, phone: claims.phone, roles: claims.roles, super: claims.super, is_staff: claims.staff, store_id: claims.store_id, force_password_change: claims.fpc } };
  }
  private refreshFrom(req: Request, body?: RefreshDto) {
    return body?.refresh_token ?? (req.cookies?.[REFRESH_COOKIE] as string | undefined);
  }

  @Public() @Post("register") @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: "Self-registration; account waits for admin approval" })
  register(@Body() dto: RegisterDto) { return this.auth.register(dto); }

  @Public() @Post("login") @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiHeader({ name: "X-Client", description: "web (default, cookie refresh) | mobile (refresh in body)", required: false })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.respond(req, res, await this.auth.login(dto.phone, dto.password, metaOf(req)));
  }

  @Public() @Post("refresh") @HttpCode(200) @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = this.refreshFrom(req, dto);
    if (!raw) return res.status(401).json({ error: "invalid_token" });
    return this.respond(req, res, await this.auth.refresh(raw, metaOf(req)));
  }

  @Public() @Post("logout") @HttpCode(204)
  async logout(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(this.refreshFrom(req, dto), (req as Request & { user?: Claims }).user?.sub);
    res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
  }

  @Post("change-password") @HttpCode(204) @AllowForcePasswordChange() @ApiBearerAuth()
  async changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() user: Claims) {
    await this.auth.changePassword(user.sub, dto);
  }

  @Public() @Post("password-reset-requests") @HttpCode(200) @Throttle({ default: { limit: 3, ttl: 300_000 } })
  @ApiOperation({ summary: "Files a manual reset request for admins; always returns ok" })
  async passwordResetRequest(@Body() dto: PasswordResetRequestDto) {
    await this.auth.requestPasswordReset(dto.phone, dto.reason);
    return { ok: true };
  }

  @Get("me") @AllowForcePasswordChange() @ApiBearerAuth()
  me(@CurrentUser() user: Claims) { return this.auth.me(user.sub); }
}
