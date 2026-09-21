import * as argon2 from "argon2";
import bcrypt from "bcryptjs";

export type PasswordAlgo = "bcrypt" | "argon2id";

/** New passwords are always argon2id. */
export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

/** Verifies against either algorithm; Supabase-migrated users still carry bcrypt hashes. */
export async function verifyPassword(plain: string, hash: string, algo: PasswordAlgo): Promise<boolean> {
  if (!hash || hash.startsWith("!")) return false;
  if (algo === "bcrypt") return bcrypt.compare(plain, hash);
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/** Same rule as the original app's forms (6–10 chars) but with no upper bound beyond sanity. */
export function isAcceptablePassword(p: string): boolean {
  return typeof p === "string" && p.length >= 6 && p.length <= 72;
}
