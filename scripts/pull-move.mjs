// Moves drizzle-kit pull output (src/db/pulled) into src/db/schema and drops the unused snapshot SQL.
import { renameSync, rmSync } from "node:fs";
renameSync("src/db/pulled/schema.ts", "src/db/schema/tables.ts");
renameSync("src/db/pulled/relations.ts", "src/db/schema/relations.ts");
rmSync("src/db/pulled", { recursive: true, force: true });
import { readFileSync, writeFileSync } from "node:fs";
writeFileSync("src/db/schema/relations.ts", readFileSync("src/db/schema/relations.ts", "utf8").replace('from "./schema"', 'from "./tables"'));
console.log("pull-move: schema files placed in src/db/schema");
