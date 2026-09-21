/** Yemeni mobile number: 9 digits, prefixes 77/78/71/73 (same rule as the original app). */
export const YEMENI_PHONE_RE = /^(77|78|71|73)\d{7}$/;

export function isValidYemeniPhone(phone: string): boolean {
  return YEMENI_PHONE_RE.test(phone);
}

/**
 * Supabase Auth had no phone identity, so the original app signed users up with a synthetic email.
 * Kept only for data-migration scripts that must map old `auth.users.email` rows back to a phone.
 */
export function phoneToEmail(phone: string): string {
  return `${phone}@baqalati.app`;
}
