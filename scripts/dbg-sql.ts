import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql, eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
const db = drizzle(new Pool({ connectionString: "postgres://wasl:wasl@127.0.0.1:55432/wasl_dev" }), { schema, casing: "snake_case" });
async function main() {
const q = db.select({ p: schema.profiles, roles: sql<string[]>`(select coalesce(array_agg(r.role::text), '{}') from ${schema.userRoles} r where r.user_id = ${schema.profiles.id})` }).from(schema.profiles).where(eq(schema.profiles.phone, "776000001"));
console.log(q.toSQL().sql);
console.log(JSON.stringify((await q)[0]?.roles));
process.exit(0);
}
main();
