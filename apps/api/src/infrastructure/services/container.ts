import { env } from "../config/env.js";
import {
  type IPaymentGateway,
  StubPaymentGateway,
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
 * Build the service container. When API keys are configured in env,
 * swap the stub implementations for real ones here.
 *
 * Example — once you set PAYSTACK_SECRET_KEY:
 *   1. Uncomment PaystackGateway in payment.service.ts
 *   2. Import it here
 *   3. Replace StubPaymentGateway with `new PaystackGateway()`
 */
export function createServiceContainer(): ServiceContainer {
  // --- Payment ---
  let payment: IPaymentGateway;
  if (env.PAYSTACK_SECRET_KEY) {
    // TODO: import { PaystackGateway } from "./payment.service.js";
    // payment = new PaystackGateway();
    payment = new StubPaymentGateway(); // swap when ready
  } else {
    payment = new StubPaymentGateway();
  }

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
