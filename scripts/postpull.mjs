// Post-processing for `drizzle-kit pull` output (run by `pnpm db:pull`):
//  - drizzle-kit renders an empty-string default as `default(')` (invalid TS)
//  - timestamps are pulled as mode:'string'; the services work with Date objects
import { readFileSync, writeFileSync } from "node:fs";
const p = new URL("../src/db/schema/tables.ts", import.meta.url);
let s = readFileSync(p, "utf8");
s = s.replace(/\.default\('\)/g, ".default('')");
s = s.replace(/mode: 'string'/g, "mode: 'date'");
writeFileSync(p, s);
console.log("postpull: fixed empty defaults and timestamp mode");
