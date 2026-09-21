import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { CurrentUser, Roles, requireStore, type Claims } from "@/common/auth";
import { CreditService } from "./credit.service";

class RespondDto extends createZodDto(z.object({ approve: z.boolean() })) {}
class EntryDto extends createZodDto(z.object({ type: z.enum(["charge", "payment"]), amount: z.number().positive().max(10_000_000), note: z.string().trim().max(300).nullable().optional() })) {}
class CreateAccountDto extends createZodDto(z.object({ customer_id: z.string().uuid() })) {}
class SearchDto extends createZodDto(z.object({ q: z.string().trim().min(2).max(40) })) {}

@ApiTags("credit") @ApiBearerAuth()
@Controller("me/credit")
export class CustomerCreditController {
  constructor(private credit: CreditService) {}
  @Get() ledger(@CurrentUser() u: Claims) { return this.credit.customerLedger(u.sub); }
  @Post("transactions/:id/respond") respond(@CurrentUser() u: Claims, @Param("id", ParseUUIDPipe) id: string, @Body() dto: RespondDto) { return this.credit.customerRespond(u.sub, id, dto.approve); }
}

@ApiTags("merchant") @ApiBearerAuth() @Roles("merchant")
@Controller("merchant")
export class MerchantCreditController {
  constructor(private credit: CreditService) {}
  @Get("credit/accounts") accounts(@CurrentUser() u: Claims) { return this.credit.storeAccounts(requireStore(u)); }
  @Post("credit/accounts") create(@CurrentUser() u: Claims, @Body() dto: CreateAccountDto) { return this.credit.merchantCreateAccount(requireStore(u), dto.customer_id); }
  @Get("credit/accounts/:id") account(@CurrentUser() u: Claims, @Param("id", ParseUUIDPipe) id: string) { return this.credit.storeAccount(requireStore(u), id); }
  @Post("credit/accounts/:id/transactions") addEntry(@CurrentUser() u: Claims, @Param("id", ParseUUIDPipe) id: string, @Body() dto: EntryDto) { return this.credit.merchantAddEntry(requireStore(u), id, dto); }
  @Post("credit/transactions/:id/cancel") cancel(@CurrentUser() u: Claims, @Param("id", ParseUUIDPipe) id: string) { return this.credit.merchantCancel(requireStore(u), id); }
  @Get("customers/search") search(@CurrentUser() u: Claims, @Query() q: SearchDto) { return this.credit.searchStoreCustomers(requireStore(u), q.q); }
}
