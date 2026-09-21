import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Public } from "@/common/auth";
import { CatalogService } from "./catalog.service";
import { BarcodeQueryDto, CatalogItemsQueryDto, ProductsQueryDto, StoresQueryDto } from "./dto";

/** Unauthenticated browsing (store_offers/banners were readable by anon before; stores/products were authenticated-only but hold no secrets). */
@ApiTags("public")
@Controller()
export class PublicController {
  constructor(private catalog: CatalogService) {}
  @Public() @Get("stores") stores(@Query() q: StoresQueryDto) { return this.catalog.listStores(q); }
  @Public() @Get("stores/:id") store(@Param("id", ParseUUIDPipe) id: string) { return this.catalog.getStore(id); }
  @Public() @Get("stores/:id/categories") storeCategories(@Param("id", ParseUUIDPipe) id: string) { return this.catalog.storeCategories(id); }
  @Public() @Get("stores/:id/products") storeProducts(@Param("id", ParseUUIDPipe) id: string, @Query() q: ProductsQueryDto) { return this.catalog.storeProducts(id, q); }
  @Public() @Get("stores/:id/offers") storeOffers(@Param("id", ParseUUIDPipe) id: string) { return this.catalog.activeOffers(id); }
  @Public() @Get("products/by-barcode") productsByBarcode(@Query() q: BarcodeQueryDto) { return this.catalog.productsByBarcode(q.barcode, q.limit); }
  @Public() @Get("banners") banners() { return this.catalog.banners(); }
  @Public() @Get("business-categories") businessCategories() { return this.catalog.businessCategories(); }
  @Public() @Get("settings/public") settings() { return this.catalog.publicSettings(); }
}

/** Shared product library (authenticated, as before). */
@ApiTags("catalog") @ApiBearerAuth()
@Controller("catalog")
export class CatalogController {
  constructor(private catalog: CatalogService) {}
  @Get("categories") categories() { return this.catalog.catalogCategories(); }
  @Get("items") items(@Query() q: CatalogItemsQueryDto) { return this.catalog.catalogItems(q); }
}
