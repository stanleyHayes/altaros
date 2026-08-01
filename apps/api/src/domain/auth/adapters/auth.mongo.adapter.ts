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
  phoneVerified: boolean;
  phoneVerificationRequired: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDocument>(
  {
    // NOT `unique: true` any more (WP-35 / ADR-006).
    //
    // Mongoose turns a field-level `unique` into a real index and rebuilds it
    // from this schema on connect. That made this line the reason the workspace
    // migration is coordinated rather than local: the Go services can drop
    // `email_1` all they like, and this API recreates it on its next boot,
    // silently restoring global uniqueness and breaking the ability of one
    // address to hold an account in two churches.
    //
    // Uniqueness now lives on the compound index below, and is declared here so
    // both writers agree on it rather than one of them owning it.
    email: { type: String, required: true, lowercase: true },
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
    // New accounts must prove control of their phone before the Go gateway
    // will issue a password session. Existing documents have no flag and are
    // grandfathered; this default applies only to newly created accounts.
    phoneVerified: { type: Boolean, default: false },
    phoneVerificationRequired: { type: Boolean, default: true },
  },
  { timestamps: true },
);

userSchema.index({ churchId: 1 });
userSchema.index({ phone: 1 });

// Workspace-scoped identity (WP-35 / ADR-006).
//
// One address may hold an account in each of two churches, and never two in one.
// These must match `uq_church_email` / `uq_church_phone` in the Go services
// exactly — name, keys and partial filter — because both writers call
// createIndexes against the same collection and a disagreement means whichever
// booted last quietly wins.
//
// `partialFilterExpression`, not `sparse`. A compound sparse index skips a
// document only when EVERY indexed field is missing, so every account without
// an email would index as {church, null} and collide with the others.
userSchema.index(
  { churchId: 1, email: 1 },
  {
    name: "uq_church_email",
    unique: true,
    partialFilterExpression: { email: { $exists: true } },
  },
);
userSchema.index(
  { churchId: 1, phone: 1 },
  {
    name: "uq_church_phone",
    unique: true,
    partialFilterExpression: { phone: { $exists: true } },
  },
);

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

/**
 * Resolves exactly one account matching a credential, optionally within one
 * church (WP-35).
 *
 * The "exactly one" is the safety property, and it is why this queries with a
 * limit of two rather than using findOne. Once identity is scoped to a
 * workspace, two accounts can legitimately share an address — and an unscoped
 * lookup that returns the first one MongoDB happens to hand back would sign
 * somebody into whichever church that turned out to be. Ambiguity is answered
 * as "no such account", which is also what the Go gateway does, and for the
 * same reason: a distinct message would confirm the address exists.
 */
async function findOneCredential(
  criteria: Record<string, unknown>,
  churchId?: string,
): Promise<(User & { passwordHash: string }) | null> {
  const filter: Record<string, unknown> = { ...criteria };
  if (churchId) {
    // Both storage forms. Mongoose writes churchId as an ObjectId; documents
    // written by the Go services before that was fixed carry a string, and
    // matching only one silently misses half a church's accounts (ADR-005).
    const forms: unknown[] = [churchId];
    if (mongoose.Types.ObjectId.isValid(churchId)) {
      forms.push(new mongoose.Types.ObjectId(churchId));
    }
    filter.churchId = { $in: forms };
  }

  const docs = await UserModel.find(filter).limit(2);
  if (docs.length !== 1) return null;
  return toUserWithHash(docs[0] as UserDocument);
}

export class MongoAuthRepository implements IAuthRepository {
  async findByEmail(
    email: string,
    churchId?: string,
  ): Promise<(User & { passwordHash: string }) | null> {
    return findOneCredential({ email: email.toLowerCase() }, churchId);
  }

  async findByPhone(
    phone: string,
    churchId?: string,
  ): Promise<(User & { passwordHash: string }) | null> {
    return findOneCredential({ phone }, churchId);
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
