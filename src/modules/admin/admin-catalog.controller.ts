import { Body, Controller, Delete, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { CurrentUser, Perms, Roles, type Claims } from "@/common/auth";
import { AdminCatalogService } from "./admin-catalog.service";

const categorySchema = z.object({ name: z.string().trim().min(1).max(120), icon: z.string().max(40).nullable().optional(), image_url: z.string().max(500).nullable().optional(), main_section: z.string().max(120).nullable().optional(), parent_category: z.string().max(120).nullable().optional(), sort_order: z.number().int().min(0).optional() });
const itemSchema = z.object({ name: z.string().trim().min(1).max(160), default_price: z.number().min(0).nullable().optional(), image_url: z.string().max(500).nullable().optional(), barcode: z.string().max(64).nullable().optional(), category_id: z.string().uuid().nullable().optional(), category_name: z.string().max(120).nullable().optional(), category_path: z.string().max(300).nullable().optional(), description: z.string().max(2000).optional(), main_section: z.string().max(120).nullable().optional(), subcategory: z.string().max(120).nullable().optional(), sort_order: z.number().int().min(0).optional(), source: z.enum(["seed", "merchant", "library_import"]).optional() });
class CatalogCategoryDto extends createZodDto(categorySchema) {}
class ItemDto extends createZodDto(itemSchema) {}
class ItemPatchDto extends createZodDto(itemSchema.partial()) {}
class BulkDto extends createZodDto(z.object({ rows: z.array(itemSchema.partial().extend({ id: z.string().uuid().optional() })).min(1).max(2000) })) {}
class ReorderDto extends createZodDto(z.object({ ordered_ids: z.array(z.string().uuid()).min(1) })) {}
class MoveDto extends createZodDto(z.object({ move_to: z.string().uuid().optional() })) {}

@ApiTags("admin") @ApiBearerAuth() @Roles("super_admin", "admin", "operations", "support", "finance") @Perms("library.manage")
@Controller("admin/catalog")
export class AdminCatalogController {
  constructor(private cat: AdminCatalogService) {}
  @Post("categories") createCategory(@CurrentUser() a: Claims, @Body() d: CatalogCategoryDto) { return this.cat.upsertCategory(a, d); }
  @Put("categories/:id") updateCategory(@CurrentUser() a: Claims, @Param("id", ParseUUIDPipe) id: string, @Body() d: CatalogCategoryDto) { return this.cat.upsertCategory(a, d, id); }
  @Delete("categories/:id") @HttpCode(204) async deleteCategory(@CurrentUser() a: Claims, @Param("id", ParseUUIDPipe) id: string, @Query() q: MoveDto) { await this.cat.deleteCategory(a, id, q.move_to); }
  @Post("categories/reorder") @HttpCode(204) async reorder(@CurrentUser() a: Claims, @Body() d: ReorderDto) { await this.cat.reorderCategories(a, d.ordered_ids); }
  @Post("items") createItem(@CurrentUser() a: Claims, @Body() d: ItemDto) { return this.cat.createItem(a, d); }
  @Put("items/:id") updateItem(@CurrentUser() a: Claims, @Param("id", ParseUUIDPipe) id: string, @Body() d: ItemPatchDto) { return this.cat.updateItem(a, id, d); }
  @Delete("items/:id") @HttpCode(204) async deleteItem(@CurrentUser() a: Claims, @Param("id", ParseUUIDPipe) id: string) { await this.cat.deleteItem(a, id); }
  @Post("items/bulk") bulk(@CurrentUser() a: Claims, @Body() d: BulkDto) { return this.cat.bulkUpsert(a, d.rows); }
  @Post("items/normalize-sort") @HttpCode(204) normalize() { return this.cat.normalizeSortOrder(); }
  @Post("wipe") @Roles("super_admin") wipe(@CurrentUser() a: Claims) { return this.cat.wipe(a); }
}
