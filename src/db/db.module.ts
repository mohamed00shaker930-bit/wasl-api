import { Global, Inject, Injectable, Module, OnModuleDestroy } from "@nestjs/common";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { APP_CONFIG } from "@/config/config.module";
import type { AppConfig } from "@/config/config.schema";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export const DB = Symbol("DB");

// numeric/decimal columns come back as strings from pg; keep them as strings in the row types and
// convert at the domain boundary (money math uses Number()/toFixed(2) explicitly).

@Injectable()
export class DbService implements OnModuleDestroy {
  readonly pool: Pool;
  readonly db: Db;
  constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
    this.pool = new Pool({ connectionString: cfg.DATABASE_URL, max: 10 });
    this.db = drizzle(this.pool, { schema, casing: "snake_case" });
  }
  /** Run `fn` inside one transaction; money operations must always go through this. */
  withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(fn);
  }
  onModuleDestroy() {
    return this.pool.end();
  }
}

@Global()
@Module({
  providers: [DbService, { provide: DB, inject: [DbService], useFactory: (s: DbService) => s.db }],
  exports: [DbService, DB],
})
export class DbModule {}
