import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Cron, CronExpression } from "@nestjs/schedule";
import type { Request } from "express";
import { CurrentUser, Public, type Claims } from "@/common/auth";
import { MeService } from "./me.service";
import { DeviceTokenDto, FavoriteDto, ListQueryDto, LocationDto, SessionCloseDto, SessionOpenDto, UpdateProfileDto } from "./dto";

@ApiTags("me") @ApiBearerAuth()
@Controller("me")
export class MeController {
  constructor(private me: MeService) {}

  @Get("profile") profile(@CurrentUser() u: Claims) { return this.me.profile(u.sub); }
  @Patch("profile") updateProfile(@CurrentUser() u: Claims, @Body() dto: UpdateProfileDto) { return this.me.updateProfile(u.sub, dto); }
  @Delete() @HttpCode(204) async deleteAccount(@CurrentUser() u: Claims) { await this.me.deleteAccount(u.sub); }

  @Get("locations") locations(@CurrentUser() u: Claims) { return this.me.listLocations(u.sub); }
  @Post("locations") addLocation(@CurrentUser() u: Claims, @Body() dto: LocationDto) { return this.me.addLocation(u.sub, dto); }
  @Put("locations/:id") updateLocation(@CurrentUser() u: Claims, @Param("id", ParseUUIDPipe) id: string, @Body() dto: LocationDto) { return this.me.updateLocation(u.sub, id, dto); }
  @Delete("locations/:id") @HttpCode(204) async deleteLocation(@CurrentUser() u: Claims, @Param("id", ParseUUIDPipe) id: string) { await this.me.deleteLocation(u.sub, id); }

  @Get("favorites") favorites(@CurrentUser() u: Claims) { return this.me.listFavorites(u.sub); }
  @Put("favorites") @HttpCode(204) async addFavorite(@CurrentUser() u: Claims, @Body() dto: FavoriteDto) { await this.me.addFavorite(u.sub, dto); }
  @Delete("favorites") @HttpCode(204) async removeFavorite(@CurrentUser() u: Claims, @Body() dto: FavoriteDto) { await this.me.removeFavorite(u.sub, dto); }

  @Get("notifications") notifications(@CurrentUser() u: Claims, @Query() q: ListQueryDto) { return this.me.listNotifications(u.sub, q.limit, q.before); }
  @Post("notifications/read-all") @HttpCode(204) async readAll(@CurrentUser() u: Claims) { await this.me.markAllRead(u.sub); }
  @Post("notifications/:id/read") @HttpCode(204) async read(@CurrentUser() u: Claims, @Param("id", ParseUUIDPipe) id: string) { await this.me.markRead(u.sub, id); }

  @Post("sessions") sessionOpen(@CurrentUser() u: Claims, @Body() dto: SessionOpenDto, @Req() req: Request) { return this.me.sessionOpen(u.sub, dto.user_agent ?? req.headers["user-agent"]); }
  @Post("sessions/:id/ping") @HttpCode(204) async sessionPing(@CurrentUser() u: Claims, @Param("id", ParseUUIDPipe) id: string) { await this.me.sessionPing(u.sub, id); }
  /** Public so `navigator.sendBeacon` can call it on pagehide; authenticated by the beacon token from sessionOpen or by a JWT. */
  @Public() @Post("sessions/:id/close") @HttpCode(204)
  async sessionClose(@Param("id", ParseUUIDPipe) id: string, @Body() dto: SessionCloseDto, @Req() req: Request) {
    await this.me.sessionClose(id, dto.close_type, { userId: (req as Request & { user?: Claims }).user?.sub, beaconToken: dto.beacon_token });
  }
  @Cron(CronExpression.EVERY_5_MINUTES) closeStale() { return this.me.closeStaleSessions(); }

  @Post("devices") @HttpCode(204) async registerDevice(@CurrentUser() u: Claims, @Body() dto: DeviceTokenDto) { await this.me.registerDevice(u.sub, dto); }
  @Delete("devices/:token") @HttpCode(204) async removeDevice(@CurrentUser() u: Claims, @Param("token") token: string) { await this.me.removeDevice(u.sub, token); }
}
