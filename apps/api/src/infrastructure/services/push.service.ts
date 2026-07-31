export interface SendPushParams {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface SendPushBatchParams {
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface IPushService {
  send(params: SendPushParams): Promise<void>;
  sendBatch(params: SendPushBatchParams): Promise<void>;
}

/**
 * Stub implementation — logs push notifications to console.
 * Replace with FirebasePushService once FIREBASE_SERVICE_ACCOUNT is configured.
 */
export class StubPushService implements IPushService {
  async send(params: SendPushParams): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(
      `[Push Stub] Token: ${params.token.slice(0, 12)}... | Title: ${params.title}`,
    );
  }

  async sendBatch(params: SendPushBatchParams): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(
      `[Push Stub] Batch (${params.tokens.length} tokens) | Title: ${params.title}`,
    );
  }
}

// --- Ready-to-use Firebase FCM implementation ---

// import admin from "firebase-admin";
// import { env } from "../config/env.js";
//
// let initialized = false;
//
// function initFirebase() {
//   if (initialized) return;
//   admin.initializeApp({
//     credential: admin.credential.cert(
//       JSON.parse(env.FIREBASE_SERVICE_ACCOUNT),
//     ),
//   });
//   initialized = true;
// }
//
// export class FirebasePushService implements IPushService {
//   constructor() {
//     initFirebase();
//   }
//
//   async send(params: SendPushParams): Promise<void> {
//     await admin.messaging().send({
//       token: params.token,
//       notification: { title: params.title, body: params.body },
//       data: params.data,
//     });
//   }
//
//   async sendBatch(params: SendPushBatchParams): Promise<void> {
//     await admin.messaging().sendEachForMulticast({
//       tokens: params.tokens,
//       notification: { title: params.title, body: params.body },
//       data: params.data,
//     });
//   }
// }
