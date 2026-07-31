import mongoose, { Schema, type Document } from "mongoose";
import type { User, UserRole } from "@altar-os/shared-types";
import type {
  IAuthRepository,
  CreateUserData,
} from "../ports/auth.repository.port.js";

interface UserDocument extends Document {
  email: string;
  phone: string;
  passwordHash: string;
  name: string;
  role: UserRole;
  churchId: mongoose.Types.ObjectId;
  avatarUrl?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDocument>(
  {
    email: { type: String, required: true, unique: true, lowercase: true },
    phone: { type: String, required: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true },
    role: {
      type: String,
      enum: ["SUPER_ADMIN", "CHURCH_ADMIN", "DEPARTMENT_LEADER", "MEMBER"],
      default: "MEMBER",
    } as unknown as typeof Schema.Types.String,
    churchId: { type: Schema.Types.ObjectId, ref: "Church", required: true },
    avatarUrl: { type: String },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

userSchema.index({ churchId: 1 });
userSchema.index({ phone: 1 });

const UserModel =
  mongoose.models.User ||
  mongoose.model<UserDocument>("User", userSchema);

function toUser(doc: UserDocument): User {
  return {
    id: doc._id.toString(),
    email: doc.email,
    phone: doc.phone,
    name: doc.name,
    role: doc.role,
    churchId: doc.churchId.toString(),
    avatarUrl: doc.avatarUrl,
    isActive: doc.isActive,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toUserWithHash(
  doc: UserDocument,
): User & { passwordHash: string } {
  return { ...toUser(doc), passwordHash: doc.passwordHash };
}

export class MongoAuthRepository implements IAuthRepository {
  async findByEmail(
    email: string,
  ): Promise<(User & { passwordHash: string }) | null> {
    const doc = await UserModel.findOne({ email: email.toLowerCase() });
    return doc ? toUserWithHash(doc as UserDocument) : null;
  }

  async findByPhone(
    phone: string,
  ): Promise<(User & { passwordHash: string }) | null> {
    const doc = await UserModel.findOne({ phone });
    return doc ? toUserWithHash(doc as UserDocument) : null;
  }

  async findById(id: string): Promise<User | null> {
    const doc = await UserModel.findById(id);
    return doc ? toUser(doc as UserDocument) : null;
  }

  async create(data: CreateUserData): Promise<User> {
    const doc = await UserModel.create(data);
    return toUser(doc as UserDocument);
  }

  async updatePassword(id: string, passwordHash: string): Promise<void> {
    await UserModel.findByIdAndUpdate(id, { passwordHash });
  }
}
