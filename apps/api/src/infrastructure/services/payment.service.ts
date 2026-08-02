export interface InitiateChargeParams {
  amount: number;
  currency: string;
  email: string;
  reference: string;
  paymentMethod: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface ChargeResult {
  authorizationUrl?: string;
  reference: string;
  status: "pending" | "success" | "failed";
}

export interface VerifyResult {
  reference: string;
  status: "success" | "failed";
  amount: number;
  paidAt?: Date;
}

export interface IPaymentGateway {
  initiateCharge(params: InitiateChargeParams): Promise<ChargeResult>;
  verifyCharge(reference: string): Promise<VerifyResult>;
}

/**
 * A gateway that REFUSES, because payments are served by the Go finance
 * service and nothing here should ever take money.
 *
 * This previously returned `{ status: "success", amount: 0 }` from
 * `verifyCharge` for any reference at all. Nothing calls it today, which is the
 * only reason that was not an incident: verification is what grants value, so a
 * gateway that says "success" unconditionally credits a church for money that
 * never moved, for every reference anybody submits.
 *
 * It now throws. A payment path that is not implemented has to fail loudly —
 * the same rule the Go notification transports follow, and for the same reason:
 * an unsent message is indistinguishable from an ignored one, and an unverified
 * payment is indistinguishable from a real one.
 */
export class UnavailablePaymentGateway implements IPaymentGateway {
  async initiateCharge(_params: InitiateChargeParams): Promise<ChargeResult> {
    throw new Error(
      "payments: this API does not take payments. Giving is served by the Go " +
        "finance service, which settles to the church's own subaccount (ADR-002).",
    );
  }

  async verifyCharge(_reference: string): Promise<VerifyResult> {
    throw new Error(
      "payments: this API cannot verify a charge. Verification is what grants " +
        "value, and answering it here would credit a church for money that " +
        "never moved.",
    );
  }
}

/** @deprecated Use UnavailablePaymentGateway. Kept so existing imports fail
 *  loudly at runtime rather than silently succeeding. */
export const StubPaymentGateway = UnavailablePaymentGateway;

// There is deliberately no Paystack implementation here, and the one that used
// to sit in this file as a commented-out template has been removed rather than
// left for somebody to enable.
//
// It omitted `subaccount`, which is not a missing feature — it is the whole
// compliance boundary. Under ADR-002 every church is its own merchant and funds
// settle directly to it; a charge with no subaccount settles to ALTAR OS, which
// is the money-custody position that would put the platform inside Ghana's Act
// 987 payment-aggregation licensing. It also omitted `transaction_charge` (so
// no commission would be taken) and multiplied a floating-point amount by 100
// (so GHS 0.10 loses a pesewa).
//
// The real implementation is internal/platform/payments/paystack in the Go
// service, which sends both fields and refuses outright to initialise a charge
// that names no subaccount.
