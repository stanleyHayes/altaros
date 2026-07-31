export interface SendSmsParams {
  to: string;
  message: string;
  from?: string;
}

export interface ISmsService {
  send(params: SendSmsParams): Promise<void>;
}

/**
 * Stub implementation — logs SMS to console.
 * Replace with AfricasTalkingSmsService or HubtelSmsService once API keys are configured.
 */
export class StubSmsService implements ISmsService {
  async send(params: SendSmsParams): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[SMS Stub] To: ${params.to} | Message: ${params.message}`);
  }
}

// --- Ready-to-use Africa's Talking implementation ---

// import { env } from "../config/env.js";
//
// export class AfricasTalkingSmsService implements ISmsService {
//   private readonly apiKey = env.AT_API_KEY;
//   private readonly username = env.AT_USERNAME;
//   private readonly from = env.AT_SENDER_ID;
//
//   async send(params: SendSmsParams): Promise<void> {
//     await fetch("https://api.africastalking.com/version1/messaging", {
//       method: "POST",
//       headers: {
//         apiKey: this.apiKey,
//         "Content-Type": "application/x-www-form-urlencoded",
//         Accept: "application/json",
//       },
//       body: new URLSearchParams({
//         username: this.username,
//         to: params.to,
//         message: params.message,
//         from: params.from ?? this.from,
//       }),
//     });
//   }
// }
