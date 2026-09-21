import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import { Client } from "pg";
import { resolve } from "node:path";
import request from "supertest";
import { AppModule } from "@/app.module";
import { runMigrations } from "@/db/migrate";

/** Drops and recreates the test database, applies migrations, boots the app. */
export async function bootTestApp() {
  const url = new URL(process.env.DATABASE_URL!);
  const dbName = url.pathname.slice(1);
  const adminUrl = new URL(process.env.DATABASE_URL!); adminUrl.pathname = "/postgres";
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  await runMigrations(process.env.DATABASE_URL!, resolve(process.cwd(), "src/db/migrations"));
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { Pool } = await import("pg");
  const schema = await import("@/db/schema");
  const { seedReferenceData } = await import("@/db/seed/index");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await seedReferenceData(drizzle(pool, { schema, casing: "snake_case" }));
  await pool.end();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  app.setGlobalPrefix("api");
  app.use(cookieParser());
  await app.init();
  const sql = new Client({ connectionString: process.env.DATABASE_URL });
  await sql.connect();
  const http = () => request(app.getHttpServer());
  return {
    app, sql, http,
    async close() { await sql.end(); await app.close(); },
    async register(body: Record<string, unknown>) { return http().post("/api/auth/register").send(body); },
    async activate(phone: string) {
      await sql.query("update profiles set account_status='active' where phone=$1", [phone]);
      await sql.query("update stores set status='active' where owner_id=(select id from users where phone=$1)", [phone]);
    },
    async login(phone: string, password: string) {
      const r = await http().post("/api/auth/login").set("x-client", "mobile").send({ phone, password });
      if (r.status !== 200) throw new Error(`login ${phone}: ${r.status} ${JSON.stringify(r.body)}`);
      return r.body as { access_token: string; refresh_token: string; user: { id: string; store_id?: string } };
    },
    async seedSuperAdmin(phone: string, password: string) {
      const { hashPassword } = await import("@/modules/auth/password");
      const { rows: [u] } = await sql.query("insert into users(phone, password_hash, password_algo) values ($1,$2,'argon2id') returning id", [phone, await hashPassword(password)]);
      await sql.query("insert into profiles(id, phone, name, account_status, user_type) values ($1,$2,'admin','active','admin')", [u.id, phone]);
      await sql.query("insert into user_roles(user_id, role) values ($1,'super_admin')", [u.id]);
      await sql.query("insert into app_settings(key, value) values ('default_commission_pct','0') on conflict do nothing");
      return u.id as string;
    },
  };
}
export type TestApp = Awaited<ReturnType<typeof bootTestApp>>;
