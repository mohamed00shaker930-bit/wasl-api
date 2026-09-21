import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser, Roles, requireStore, type Claims } from "@/common/auth";
import { OrdersService } from "./orders.service";
import { CheckoutDto, DecisionDto, OrdersQueryDto, RatingDto, ReturnDto, StatusDto } from "./dto";

@ApiTags("orders") @ApiBearerAuth()
@Controller()
export class CustomerOrdersController {
  constructor(private orders: OrdersService) {}
  @Post("orders") @Roles("customer", "merchant") checkout(@CurrentUser() u: Claims, @Body() dto: CheckoutDto) { return this.orders.checkout(u.sub, dto); }
  @Get("me/orders") list(@CurrentUser() u: Claims, @Query() q: OrdersQueryDto) { return this.orders.listForCustomer(u.sub, q); }
  @Get("me/orders/:id") get(@CurrentUser() u: Claims, @Param("id", ParseUUIDPipe) id: string) { return this.orders.getForCustomer(u.sub, id); }
  @Post("me/orders/:id/cancel") cancel(@CurrentUser() u: Claims, @Param("id", ParseUUIDPipe) id: string) { return this.orders.customerCancel(u.sub, id); }
  @Post("me/orders/:id/return") requestReturn(@CurrentUser() u: Claims, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ReturnDto) { return this.orders.customerRequestReturn(u.sub, id, dto.reason); }
  @Post("me/orders/:id/rating") rate(@CurrentUser() u: Claims, @Param("id", ParseUUIDPipe) id: string, @Body() dto: RatingDto) { return this.orders.customerRate(u.sub, id, dto.stars, dto.comment); }
}

@ApiTags("merchant") @ApiBearerAuth() @Roles("merchant")
@Controller("merchant/orders")
export class MerchantOrdersController {
  constructor(private orders: OrdersService) {}
  @Get() list(@CurrentUser() u: Claims, @Query() q: OrdersQueryDto) { return this.orders.listForStore(requireStore(u), q); }
  @Get(":id") get(@CurrentUser() u: Claims, @Param("id", ParseUUIDPipe) id: string) { return this.orders.getForStore(requireStore(u), id); }
  @Get(":id/customer") customer(@CurrentUser() u: Claims, @Param("id", ParseUUIDPipe) id: string) { return this.orders.orderCustomer(requireStore(u), id); }
  @Patch(":id/status") status(@CurrentUser() u: Claims, @Param("id", ParseUUIDPipe) id: string, @Body() dto: StatusDto) { return this.orders.merchantSetStatus(requireStore(u), id, dto.status); }
  @Post(":id/credit-decision") creditDecision(@CurrentUser() u: Claims, @Param("id", ParseUUIDPipe) id: string, @Body() dto: DecisionDto) { return this.orders.merchantCreditDecision(requireStore(u), id, dto.approve); }
  @Post(":id/return-decision") returnDecision(@CurrentUser() u: Claims, @Param("id", ParseUUIDPipe) id: string, @Body() dto: DecisionDto) { return this.orders.merchantReturnDecision(requireStore(u), id, dto.approve); }
  @Post(":id/customer-rating") rateCustomer(@CurrentUser() u: Claims, @Param("id", ParseUUIDPipe) id: string, @Body() dto: RatingDto) { return this.orders.merchantRateCustomer(requireStore(u), id, dto.stars, dto.comment); }
}
