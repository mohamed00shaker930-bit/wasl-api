import { Controller, Get } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DbService } from "./db/db.module";
import { Public } from "./common/auth";

@Controller("health")
export class HealthController {
  constructor(private dbs: DbService) {}
  @Public() @Get()
  async health() {
    const t = Date.now();
    await this.dbs.db.execute(sql`select 1`);
    return { ok: true, db_ms: Date.now() - t, version: process.env.npm_package_version ?? "dev" };
  }
}
