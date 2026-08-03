import { describe, expect, it } from "vitest";
import { paymentReturnDeepLink, paymentReturnReference } from "./GivingReturnPage";

const reference = `alt_${"a".repeat(32)}`;

describe("payment return bridge", () => {
  it("normalizes either provider callback alias into one app-owned deep link", () => {
    expect(paymentReturnReference(`?reference=${reference.toUpperCase()}`)).toBe(reference);
    expect(paymentReturnDeepLink(`?trxref=${reference}`))
      .toBe(`altaros://giving/complete?reference=${reference}`);
    expect(paymentReturnDeepLink(`?reference=${reference}&trxref=${reference.toUpperCase()}`))
      .toBe(`altaros://giving/complete?reference=${reference}`);
  });

  it("refuses mismatched, duplicated, unknown, or malformed callback data", () => {
    const otherReference = `alt_${"b".repeat(32)}`;
    expect(paymentReturnDeepLink(`?reference=${reference}&trxref=${otherReference}`)).toBeNull();
    expect(paymentReturnDeepLink(`?reference=${reference}&reference=${reference}`)).toBeNull();
    expect(paymentReturnDeepLink(`?reference=${reference}&next=https://evil.example`)).toBeNull();
    expect(paymentReturnDeepLink("?reference=javascript:alert(1)")).toBeNull();
    expect(paymentReturnDeepLink("")).toBeNull();
  });
});
