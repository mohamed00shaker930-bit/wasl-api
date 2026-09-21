import { Module } from "@nestjs/common";
import { CustomRequestsController } from "./custom-requests.controller";
@Module({ controllers: [CustomRequestsController] })
export class CustomRequestsModule {}
