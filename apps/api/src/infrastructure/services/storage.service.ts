export interface UploadParams {
  buffer: Buffer;
  filename: string;
  folder?: string;
  mimeType?: string;
}

export interface UploadResult {
  url: string;
  publicId: string;
}

export interface IStorageService {
  upload(params: UploadParams): Promise<UploadResult>;
  delete(publicId: string): Promise<void>;
}

/**
 * Stub implementation — returns a placeholder URL.
 * Replace with CloudinaryStorageService once API keys are configured.
 */
export class StubStorageService implements IStorageService {
  async upload(params: UploadParams): Promise<UploadResult> {
    const id = `stub_${Date.now()}_${params.filename}`;
    return {
      url: `https://placeholder.local/uploads/${id}`,
      publicId: id,
    };
  }

  async delete(_publicId: string): Promise<void> {
    // no-op
  }
}

// --- Ready-to-use Cloudinary implementation ---

// import { v2 as cloudinary } from "cloudinary";
// import { env } from "../config/env.js";
//
// cloudinary.config({
//   cloud_name: env.CLOUDINARY_CLOUD_NAME,
//   api_key: env.CLOUDINARY_API_KEY,
//   api_secret: env.CLOUDINARY_API_SECRET,
// });
//
// export class CloudinaryStorageService implements IStorageService {
//   async upload(params: UploadParams): Promise<UploadResult> {
//     return new Promise((resolve, reject) => {
//       const stream = cloudinary.uploader.upload_stream(
//         {
//           folder: params.folder ?? "altar-os",
//           resource_type: "auto",
//           public_id: params.filename.replace(/\.[^.]+$/, ""),
//         },
//         (error, result) => {
//           if (error || !result) return reject(error);
//           resolve({ url: result.secure_url, publicId: result.public_id });
//         },
//       );
//       stream.end(params.buffer);
//     });
//   }
//
//   async delete(publicId: string): Promise<void> {
//     await cloudinary.uploader.destroy(publicId);
//   }
// }
