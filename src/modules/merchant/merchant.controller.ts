import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { CurrentUser, Roles, requireStore, type Claims } from "@/common/auth";
import { MerchantService } from "./merchant.service";
import { CategoryDto, CreateProductDto, ImportFromCatalogDto, OfferDto, OfferPatchDto, PendingCustomerDto, PosProductDto, PosSaleDto, QuoteDto, RangeDto, SnapshotDto, UpdateProductDto, UpdateStoreDto } from "./dto";

@ApiTags("merchant") @ApiBearerAuth() @Roles("merchant")
@Controller("merchant")
export class MerchantController {
  constructor(private m: MerchantService) {}

  @Get("store") store(@CurrentUser() u: Claims) { return this.m.store(requireStore(u)); }
  @Patch("store") updateStore(@CurrentUser() u: Claims, @Body() d: UpdateStoreDto) { return this.m.updateStore(requireStore(u), d); }
  @Get("dashboard") dashboard(@CurrentUser() u: Claims) { return this.m.dashboard(requireStore(u)); }

  @Get("categories") categories(@CurrentUser() u: Claims) { return this.m.categories(requireStore(u)); }
  @Post("categories") createCategory(@CurrentUser() u: Claims, @Body() d: CategoryDto) { return this.m.createCategory(requireStore(u), d); }
  @Put("categories/:id") updateCategory(@CurrentUser() u: Claims, @Param("id", ParseUUIDPipe) id: string, @Body() d: CategoryDto) { return this.m.updateCategory(requireStore(u), id, d); }
  @Delete("categories/:id") @HttpCode(204) async deleteCategory(@CurrentUser() u: Claims, @Param("id", ParseUUIDPipe) id: string) { await this.m.deleteCategory(requireStore(u), id); }

  @Get("products") products(@CurrentUser() u: Claims) { return this.m.products(requireStore(u)); }
  @Post("products") createProduct(@CurrentUser() u: Claims, @Body() d: CreateProductDto) { return this.m.createProduct(requireStore(u), d); }
  @Patch("products/:id") updateProduct(@CurrentUser() u: Claims, @Param("id", ParseUUIDPipe) id: string, @Body() d: UpdateProductDto) { return this.m.updateProduct(requireStore(u), id, d); }
  @Delete("products/:id") @HttpCode(204) async deleteProduct(@CurrentUser() u: Claims, @Param("id", ParseUUIDPipe) id: string) { await this.m.deleteProduct(requireStore(u), id); }
  @Post("products/import-from-catalog") importFromCatalog(@CurrentUser() u: Claims, @Body() d: ImportFromCatalogDto) { return this.m.importFromCatalog(requireStore(u), d.catalog_item_ids); }

  @Get("offers") offers(@CurrentUser() u: Claims) { return this.m.offers(requireStore(u)); }
  @Post("offers") createOffer(@CurrentUser() u: Claims, @Body() d: OfferDto) { return this.m.createOffer(requireStore(u), d); }
  @Patch("offers/:id") updateOffer(@CurrentUser() u: Claims, @Param("id", ParseUUIDPipe) id: string, @Body() d: OfferPatchDto) { return this.m.updateOffer(requireStore(u), id, d); }
  @Delete("offers/:id") @HttpCode(204) async deleteOffer(@CurrentUser() u: Claims, @Param("id", ParseUUIDPipe) id: string) { await this.m.deleteOffer(requireStore(u), id); }

  @Get("pending-customers") pendingCustomers(@CurrentUser() u: Claims) { return this.m.pendingCustomers(requireStore(u)); }
  @Post("pending-customers") createPendingCustomer(@CurrentUser() u: Claims, @Body() d: PendingCustomerDto) { return this.m.createPendingCustomer(requireStore(u), u.sub, d); }

  @Get("custom-requests") customRequests(@CurrentUser() u: Claims) { return this.m.customRequests(requireStore(u)); }
  @Post("custom-requests/:id/quote") quote(@CurrentUser() u: Claims, @Param("id", ParseUUIDPipe) id: string, @Body() d: QuoteDto) { return this.m.quote(requireStore(u), id, d.price, d.note ?? null); }
  @Post("custom-requests/:id/reject") rejectRequest(@CurrentUser() u: Claims, @Param("id", ParseUUIDPipe) id: string) { return this.m.rejectRequest(requireStore(u), id); }

  @Get("reports/summary") reportSummary(@CurrentUser() u: Claims, @Query() q: RangeDto) { return this.m.reportSummary(requireStore(u), new Date(q.from), new Date(q.to)); }
  @Get("reports/orders") reportOrders(@CurrentUser() u: Claims, @Query() q: RangeDto) { return this.m.reportOrders(requireStore(u), new Date(q.from), new Date(q.to)); }

  @Get("pos/snapshot") snapshot(@CurrentUser() u: Claims, @Query() q: SnapshotDto) { return this.m.posSnapshot(requireStore(u), q.since ? new Date(q.since) : undefined); }
  @Post("pos/sales") async posSale(@CurrentUser() u: Claims, @Body() d: PosSaleDto, @Res({ passthrough: true }) res: Response) {
    const r = await this.m.posSale(requireStore(u), u.sub, d);
    res.status(r.replay ? 200 : 201);
    return { replay: r.replay, ...r.result };
  }
  @Post("pos/products") async posProduct(@CurrentUser() u: Claims, @Body() d: PosProductDto, @Res({ passthrough: true }) res: Response) {
    const r = await this.m.posProduct(requireStore(u), d);
    res.status(r.replay ? 200 : 201);
    return { replay: r.replay, product: r.result };
  }
}
