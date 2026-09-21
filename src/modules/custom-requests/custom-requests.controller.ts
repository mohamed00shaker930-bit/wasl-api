import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { and, desc, eq } from "drizzle-orm";
import { CurrentUser, type Claims } from "@/common/auth";
import { DbService } from "@/db/db.module";
import { customProductRequests, stores } from "@/db/schema";
import { AppError } from "@/common/errors/app-error";

class CreateDto extends createZodDto(z.object({ store_id: z.string().uuid(), name: z.string().trim().min(1).max(160), description: z.string().trim().max(1000).nullable().optional(), qty: z.number().int().min(1).max(999).default(1), image_url: z.string().max(500).nullable().optional() })) {}

/** Customer side of "طلب منتج غير متوفر" (orders.tsx + CustomRequestDialog.tsx). Merchant side lives in the merchant module. */
@ApiTags("custom-requests") @ApiBearerAuth()
@Controller("me/custom-requests")
export class CustomRequestsController {
  constructor(private dbs: DbService) {}
  @Get() list(@CurrentUser() u: Claims) {
    return this.dbs.db.select({ r: customProductRequests, storeName: stores.name }).from(customProductRequests).innerJoin(stores, eq(stores.id, customProductRequests.storeId))
      .where(eq(customProductRequests.customerId, u.sub)).orderBy(desc(customProductRequests.createdAt));
  }
  @Post() async create(@CurrentUser() u: Claims, @Body() d: CreateDto) {
    const [s] = await this.dbs.db.select({ id: stores.id }).from(stores).where(and(eq(stores.id, d.store_id), eq(stores.status, "active"))).limit(1);
    if (!s) throw new AppError("store_missing");
    const [r] = await this.dbs.db.insert(customProductRequests).values({ customerId: u.sub, storeId: d.store_id, name: d.name, description: d.description ?? null, qty: d.qty, imageUrl: d.image_url ?? null }).returning();
    return r;
  }
  /** Accept or reject the merchant's quote. */
  @Post(":id/accept") accept(@CurrentUser() u: Claims, @Param("id", ParseUUIDPipe) id: string) { return this.decide(u.sub, id, "accepted"); }
  @Post(":id/reject") reject(@CurrentUser() u: Claims, @Param("id", ParseUUIDPipe) id: string) { return this.decide(u.sub, id, "rejected"); }
  private async decide(customerId: string, id: string, status: "accepted" | "rejected") {
    const [r] = await this.dbs.db.update(customProductRequests).set({ status }).where(and(eq(customProductRequests.id, id), eq(customProductRequests.customerId, customerId), eq(customProductRequests.status, "quoted"))).returning();
    if (!r) throw new AppError("not_found");
    return r;
  }
}
