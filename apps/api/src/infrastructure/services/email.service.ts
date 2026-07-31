export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

export interface IEmailService {
  send(params: SendEmailParams): Promise<void>;
}

/**
 * Stub implementation — logs emails to console.
 * Replace with ResendEmailService once RESEND_API_KEY is configured.
 */
export class StubEmailService implements IEmailService {
  async send(params: SendEmailParams): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(
      `[Email Stub] To: ${params.to} | Subject: ${params.subject}`,
    );
  }
}

// --- Ready-to-use Resend implementation ---

// import { env } from "../config/env.js";
//
// export class ResendEmailService implements IEmailService {
//   private readonly apiKey = env.RESEND_API_KEY;
//   private readonly fromEmail = env.RESEND_FROM_EMAIL;
//
//   async send(params: SendEmailParams): Promise<void> {
//     await fetch("https://api.resend.com/emails", {
//       method: "POST",
//       headers: {
//         Authorization: `Bearer ${this.apiKey}`,
//         "Content-Type": "application/json",
//       },
//       body: JSON.stringify({
//         from: params.from ?? this.fromEmail,
//         to: [params.to],
//         subject: params.subject,
//         html: params.html,
//       }),
//     });
//   }
// }
