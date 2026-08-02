import { env } from "../config/env.js";
import {
  type IPaymentGateway,
  UnavailablePaymentGateway,
} from "./payment.service.js";
import { type ISmsService, StubSmsService } from "./sms.service.js";
import { type IEmailService, StubEmailService } from "./email.service.js";
import { type IPushService, StubPushService } from "./push.service.js";
import {
  type IStorageService,
  StubStorageService,
} from "./storage.service.js";

export interface ServiceContainer {
  payment: IPaymentGateway;
  sms: ISmsService;
  email: IEmailService;
  push: IPushService;
  storage: IStorageService;
}

/**
 * Build the service container for the legacy TypeScript API.
 *
 * The instructions that used to live here told the reader to enable a Paystack
 * gateway in payment.service.ts. That gateway sent no `subaccount`, so
 * following them would have settled every gift to ALTAR OS rather than to the
 * church — the money-custody position ADR-002 exists to avoid, and the one that
 * would put the platform inside Act 987 licensing. They have been removed along
 * with the gateway.
 *
 * Payments are served by the Go finance service. This API does not take money,
 * and its gateway refuses rather than pretending.
 */
export function createServiceContainer(): ServiceContainer {
  // --- Payment ---
  //
  // Not conditional on PAYSTACK_SECRET_KEY. A key being present is not a reason
  // for THIS service to start taking payments, and branching on it is what made
  // the previous version look like it would do something useful once configured.
  const payment: IPaymentGateway = new UnavailablePaymentGateway();

  // --- SMS ---
  let sms: ISmsService;
  if (env.AT_API_KEY) {
    // TODO: import { AfricasTalkingSmsService } from "./sms.service.js";
    // sms = new AfricasTalkingSmsService();
    sms = new StubSmsService();
  } else {
    sms = new StubSmsService();
  }

  // --- Email ---
  let email: IEmailService;
  if (env.RESEND_API_KEY) {
    // TODO: import { ResendEmailService } from "./email.service.js";
    // email = new ResendEmailService();
    email = new StubEmailService();
  } else {
    email = new StubEmailService();
  }

  // --- Push ---
  let push: IPushService;
  if (env.FIREBASE_SERVICE_ACCOUNT) {
    // TODO: import { FirebasePushService } from "./push.service.js";
    // push = new FirebasePushService();
    push = new StubPushService();
  } else {
    push = new StubPushService();
  }

  // --- Storage ---
  let storage: IStorageService;
  if (env.CLOUDINARY_CLOUD_NAME) {
    // TODO: import { CloudinaryStorageService } from "./storage.service.js";
    // storage = new CloudinaryStorageService();
    storage = new StubStorageService();
  } else {
    storage = new StubStorageService();
  }

  return { payment, sms, email, push, storage };
}

/**
 * Singleton container instance — import this from controllers.
 */
export const services = createServiceContainer();
