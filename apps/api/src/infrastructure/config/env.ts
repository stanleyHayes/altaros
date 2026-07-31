import dotenv from "dotenv";

dotenv.config();

export const env = {
  PORT: parseInt(process.env.PORT || "3001", 10),
  MONGODB_URI:
    process.env.MONGODB_URI || "mongodb://localhost:27017/altar-os",
  JWT_SECRET: process.env.JWT_SECRET || "dev-secret-change-me",
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "7d",
  CORS_ORIGIN: process.env.CORS_ORIGIN || "http://localhost:5173",

  // Payment gateway (Paystack)
  PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY || "",
  PAYSTACK_PUBLIC_KEY: process.env.PAYSTACK_PUBLIC_KEY || "",
  PAYMENT_CALLBACK_URL: process.env.PAYMENT_CALLBACK_URL || "",

  // SMS (Africa's Talking)
  AT_API_KEY: process.env.AT_API_KEY || "",
  AT_USERNAME: process.env.AT_USERNAME || "",
  AT_SENDER_ID: process.env.AT_SENDER_ID || "",

  // Email (Resend)
  RESEND_API_KEY: process.env.RESEND_API_KEY || "",
  RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL || "",

  // Push notifications (Firebase)
  FIREBASE_SERVICE_ACCOUNT: process.env.FIREBASE_SERVICE_ACCOUNT || "",

  // Storage (Cloudinary)
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME || "",
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY || "",
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET || "",
} as const;
