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
 * Stub implementation — records transactions locally without calling a payment provider.
 * Replace with PaystackGateway or FlutterwaveGateway once API keys are configured.
 */
export class StubPaymentGateway implements IPaymentGateway {
  async initiateCharge(params: InitiateChargeParams): Promise<ChargeResult> {
    return {
      reference: params.reference,
      status: "pending",
    };
  }

  async verifyCharge(reference: string): Promise<VerifyResult> {
    return {
      reference,
      status: "success",
      amount: 0,
      paidAt: new Date(),
    };
  }
}

// --- Ready-to-use Paystack implementation (uncomment when key is set) ---

// import { env } from "../config/env.js";
//
// export class PaystackGateway implements IPaymentGateway {
//   private readonly baseUrl = "https://api.paystack.co";
//   private readonly secretKey = env.PAYSTACK_SECRET_KEY;
//
//   async initiateCharge(params: InitiateChargeParams): Promise<ChargeResult> {
//     const res = await fetch(`${this.baseUrl}/transaction/initialize`, {
//       method: "POST",
//       headers: {
//         Authorization: `Bearer ${this.secretKey}`,
//         "Content-Type": "application/json",
//       },
//       body: JSON.stringify({
//         amount: params.amount * 100, // Paystack uses kobo/pesewas
//         email: params.email,
//         reference: params.reference,
//         currency: params.currency,
//         callback_url: params.callbackUrl,
//         metadata: params.metadata,
//       }),
//     });
//     const data = await res.json();
//
//     return {
//       authorizationUrl: data.data?.authorization_url,
//       reference: data.data?.reference ?? params.reference,
//       status: "pending",
//     };
//   }
//
//   async verifyCharge(reference: string): Promise<VerifyResult> {
//     const res = await fetch(
//       `${this.baseUrl}/transaction/verify/${encodeURIComponent(reference)}`,
//       {
//         headers: { Authorization: `Bearer ${this.secretKey}` },
//       },
//     );
//     const data = await res.json();
//
//     return {
//       reference,
//       status: data.data?.status === "success" ? "success" : "failed",
//       amount: (data.data?.amount ?? 0) / 100,
//       paidAt: data.data?.paid_at ? new Date(data.data.paid_at) : undefined,
//     };
//   }
// }
