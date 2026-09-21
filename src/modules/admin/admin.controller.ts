import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { CurrentUser, Perms, Roles, type Claims } from "@/common/auth";
import { AdminUsersService } from "./admin-users.service";
import { AdminPlatformService } from "./admin-platform.service";
import { AdminKpisService } from "./admin-kpis.service";
import { AccountStatusDto, AdminUpdateProfileDto, BroadcastDto, CreateStaffDto, CreateUserDto, DecideDto, DecideResetDto, ListUsersDto, OrdersFilterDto, SendNotificationDto, SettingDto, StatusFilterDto, StoreCategoryDto, StoreCommissionDto, StoreStatusDto, UserRoleDto, WalletGrantDto, WalletRespondDto } from "./dto";

class GrantPermDto extends createZodDto(z.object({ user_id: z.string().uuid(), perm: z.string().max(60), grant: z.boolean() })) {}
class BundleDto extends createZodDto(z.object({ label: z.string().trim().min(1).max(80), perms: z.array(z.string().max(60)).default([]), sort: z.number().int().min(0).optional() })) {}
class ApplyBundleDto extends createZodDto(z.object({ user_id: z.string().uuid() })) {}
class BannerDto extends createZodDto(z.object({ title: z.string().trim().max(120).nullable().optional(), subtitle: z.string().max(200).nullable().optional(), image_url: z.string().max(500).nullable().optional(), link: z.string().max(300).nullable().optional(), bg_color: z.string().max(20).nullable().optional(), store_id: z.string().uuid().nullable().optional(), is_active: z.boolean().optional(), sort_order: z.number().int().min(0).optional() })) {}
class BusinessCategoryDto extends createZodDto(z.object({ name_ar: z.string().trim().min(1).max(80), slug: z.string().max(80).optional(), is_active: z.boolean().optional(), sort_order: z.number().int().min(0).optional() })) {}
class AuditQueryDto extends createZodDto(z.object({ user_id: z.string().uuid().optional(), search: z.string().max(60).optional(), role_group: z.string().max(20).optional(), action: z.string().max(40).optional(), table: z.string().max(60).optional(), from: z.string().datetime().optional(), to: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) })) {}
class UserFilterDto extends createZodDto(z.object({ user_id: z.string().uuid().optional(), search: z.string().max(60).optional(), status: z.string().max(20).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) })) {}
class KpisDto extends createZodDto(z.object({ from: z.string().datetime(), to: z.string().datetime(), grain: z.enum(["day", "week", "month"]).default("day") })) {}
class SearchDto extends createZodDto(z.object({ search: z.string().max(60).optional(), limit: z.coerce.number().int().min(1).max(500).default(100) })) {}

/** Every admin route needs a staff role; finer permissions per area (super_admin bypasses). All mutations write audit_logs. */
@ApiTags("admin") @ApiBearerAuth() @Roles("super_admin", "admin", "operations", "support", "finance")
@Controller("admin")
export class AdminController {
  constructor(private users: AdminUsersService, private platform: AdminPlatformService, private kpis: AdminKpisService) {}

  @Get("overview") overview() { return this.platform.overview(); }
  @Get("kpis") @Perms("kpis.view") kpisRange(@Query() q: KpisDto) { return this.kpis.kpis(new Date(q.from), new Date(q.to), q.grain); }

  // users
  @Get("users") @Perms("users.view") listUsers(@Query() q: ListUsersDto) { return this.users.list(q); }
  @Post("users") @Perms("users.create") createUser(@CurrentUser() a: Claims, @Body() d: CreateUserDto) { return this.users.createUser(a, d); }
  @Post("staff") @Roles("super_admin") createStaff(@CurrentUser() a: Claims, @Body() d: CreateStaffDto) { return this.users.createStaff(a, d); }
  @Get("users/:id") @Perms("users.view") user(@Param("id", ParseUUIDPipe) id: string) { return this.users.detail(id); }
  @Patch("users/:id/profile") @Perms("users.edit") updateProfile(@CurrentUser() a: Claims, @Param("id", ParseUUIDPipe) id: string, @Body() d: AdminUpdateProfileDto) { return this.users.updateProfile(a, id, d); }
  @Post("users/:id/status") @Perms("users.suspend") setStatus(@CurrentUser() a: Claims, @Param("id", ParseUUIDPipe) id: string, @Body() d: AccountStatusDto) { return this.users.setStatus(a, id, d); }
  @Post("users/:id/role") @Roles("super_admin") setRole(@CurrentUser() a: Claims, @Param("id", ParseUUIDPipe) id: string, @Body() d: UserRoleDto) { return this.users.setRole(a, id, d); }
  @Post("users/:id/wallet-grant") @Perms("users.wallet_grant") grantWallet(@CurrentUser() a: Claims, @Param("id", ParseUUIDPipe) id: string, @Body() d: WalletGrantDto) { return this.users.grantWallet(a, id, d.amount, d.note); }
  @Get("account-requests") @Perms("requests.decide") accountRequests() { return this.users.pendingAccountRequests(); }
  @Post("account-requests/:id/decide") @Perms("requests.decide") decideAccount(@CurrentUser() a: Claims, @Param("id", ParseUUIDPipe) id: string, @Body() d: DecideDto) { return this.users.decideAccountRequest(a, id, d.approve, d.reason); }
  @Get("password-resets") @Perms("resets.decide") passwordResets(@Query() q: StatusFilterDto) { return this.users.listPasswordResets(q.status); }
  @Post("password-resets/:id/decide") @Perms("resets.decide") decideReset(@CurrentUser() a: Claims, @Param("id", ParseUUIDPipe) id: string, @Body() d: DecideResetDto) { return this.users.decidePasswordReset(a, id, d.approve, d.temp_password); }

  // stores + orders
  @Get("stores") @Perms("stores.manage") stores(@Query() q: StatusFilterDto) { return this.platform.listStores(q.status); }
  @Post("stores/:id/status") @Perms("stores.manage") storeStatus(@CurrentUser() a: Claims, @Param("id", ParseUUIDPipe) id: string, @Body() d: StoreStatusDto) { return this.platform.setStoreStatus(a, id, d.status); }
  @Post("stores/:id/commission") @Perms("stores.manage") storeCommission(@CurrentUser() a: Claims, @Param("id", ParseUUIDPipe) id: string, @Body() d: StoreCommissionDto) { return this.platform.setStoreCommission(a, id, d.commission_pct); }
  @Post("stores/:id/category") @Perms("stores.manage") storeCategory(@CurrentUser() a: Claims, @Param("id", ParseUUIDPipe) id: string, @Body() d: StoreCategoryDto) { return this.platform.setStoreCategory(a, id, d.business_category_id); }
  @Get("orders") @Perms("orders.view") orders(@Query() q: OrdersFilterDto) { return this.platform.listOrders(q); }

  // wallets
  @Get("wallets/transactions") @Perms("wallets.manage") walletTx(@Query() q: StatusFilterDto) { return this.platform.listWalletTx(q.status, q.limit); }
  @Post("wallets/transactions/:id/respond") @Perms("wallets.manage") respondWallet(@CurrentUser() a: Claims, @Param("id", ParseUUIDPipe) id: string, @Body() d: WalletRespondDto) { return this.platform.respondWalletTx(a, id, d.approve); }

  // settings + notifications
  @Get("settings") @Perms("settings.manage") settings() { return this.platform.settings(); }
  @Put("settings/:key") @Perms("settings.manage") setSetting(@CurrentUser() a: Claims, @Param("key") key: string, @Body() d: SettingDto) { return this.platform.setSetting(a, key, d.value); }
  @Post("notifications/send") @Perms("users.notify") send(@CurrentUser() a: Claims, @Body() d: SendNotificationDto) { return this.platform.send(a, d); }
  @Post("notifications/broadcast") @Perms("broadcast.send") broadcast(@CurrentUser() a: Claims, @Body() d: BroadcastDto) { return this.platform.broadcast(a, d); }
  @Get("notifications") @Perms("oversight.view") allNotifications(@Query() q: SearchDto) { return this.platform.allNotifications(q.search, q.limit); }

  // permissions (super only)
  @Get("permissions/catalog") @Roles("super_admin") permissionCatalog() { return this.platform.permissionCatalog(); }
  @Get("permissions/users/:id") @Roles("super_admin") userPerms(@Param("id", ParseUUIDPipe) id: string) { return this.platform.userPermissions(id); }
  @Post("permissions/grant") @Roles("super_admin") grant(@CurrentUser() a: Claims, @Body() d: GrantPermDto) { return this.platform.grantPermission(a, d.user_id, d.perm, d.grant); }
  @Put("permissions/bundles/:bundle") @Roles("super_admin") upsertBundle(@CurrentUser() a: Claims, @Param("bundle") bundle: string, @Body() d: BundleDto) { return this.platform.upsertBundle(a, bundle, d.label, d.perms, d.sort); }
  @Delete("permissions/bundles/:bundle") @Roles("super_admin") @HttpCode(204) async deleteBundle(@CurrentUser() a: Claims, @Param("bundle") bundle: string) { await this.platform.deleteBundle(a, bundle); }
  @Post("permissions/bundles/:bundle/apply") @Roles("super_admin") applyBundle(@CurrentUser() a: Claims, @Param("bundle") bundle: string, @Body() d: ApplyBundleDto) { return this.platform.applyBundle(a, d.user_id, bundle); }

  // content
  @Get("banners") @Perms("content.manage") banners() { return this.platform.banners(); }
  @Post("banners") @Perms("content.manage") createBanner(@CurrentUser() a: Claims, @Body() d: BannerDto) { return this.platform.upsertBanner(a, d); }
  @Put("banners/:id") @Perms("content.manage") updateBanner(@CurrentUser() a: Claims, @Param("id", ParseUUIDPipe) id: string, @Body() d: BannerDto) { return this.platform.upsertBanner(a, { ...d, id }); }
  @Delete("banners/:id") @Perms("content.manage") @HttpCode(204) async deleteBanner(@CurrentUser() a: Claims, @Param("id", ParseUUIDPipe) id: string) { await this.platform.deleteBanner(a, id); }
  @Get("business-categories") @Perms("content.manage") businessCategories() { return this.platform.businessCategoriesAll(); }
  @Post("business-categories") @Perms("content.manage") createBusinessCategory(@CurrentUser() a: Claims, @Body() d: BusinessCategoryDto) { return this.platform.upsertBusinessCategory(a, d); }
  @Put("business-categories/:id") @Perms("content.manage") updateBusinessCategory(@CurrentUser() a: Claims, @Param("id", ParseUUIDPipe) id: string, @Body() d: BusinessCategoryDto) { return this.platform.upsertBusinessCategory(a, { ...d, id }); }
  @Delete("business-categories/:id") @Perms("content.manage") @HttpCode(204) async deleteBusinessCategory(@CurrentUser() a: Claims, @Param("id", ParseUUIDPipe) id: string) { await this.platform.deleteBusinessCategory(a, id); }

  // oversight
  @Get("audit-logs") @Perms("oversight.view") auditLogs(@Query() q: AuditQueryDto) { return this.platform.auditLogsList(q); }
  @Get("login-sessions") @Perms("oversight.view") loginSessions(@Query() q: UserFilterDto) { return this.platform.loginSessions(q); }
  @Get("app-usage") @Perms("oversight.view") appUsage(@Query() q: UserFilterDto) { return this.platform.appUsage(q); }
  @Get("user-files") @Perms("oversight.view") userFiles(@Query() q: UserFilterDto) { return this.platform.userFiles(q); }
}
