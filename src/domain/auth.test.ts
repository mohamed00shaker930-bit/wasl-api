import { describe, it, expect } from "vitest";
import { isValidYemeniPhone, phoneToEmail } from "@/domain/phone";

describe("isValidYemeniPhone", () => {
  it("يقبل الأرقام الصحيحة", () => {
    for (const p of ["771234567", "781234567", "711234567", "731234567"]) {
      expect(isValidYemeniPhone(p)).toBe(true);
    }
  });
  it("يرفض الأرقام الخاطئة", () => {
    for (const p of ["761234567", "77123456", "7712345678", "967771234567", "", "abcdefghi"]) {
      expect(isValidYemeniPhone(p)).toBe(false);
    }
  });
});

describe("phoneToEmail", () => {
  it("يبني البريد من الرقم المجرد", () => {
    expect(phoneToEmail("771234567")).toBe("771234567@baqalati.app");
  });
});
