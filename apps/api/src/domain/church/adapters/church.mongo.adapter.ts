import mongoose, { Schema, type Document } from "mongoose";
import type { Church, ChurchPlan, PaginationQuery } from "@altar-os/shared-types";
import type {
  IChurchRepository,
  CreateChurchData,
  UpdateChurchData,
  PaginatedResult,
} from "../ports/church.repository.port.js";

interface ChurchDocument extends Document {
  name: string;
  slug: string;
  address: string;
  city: string;
  country: string;
  phone: string;
  email: string;
  website?: string;
  logoUrl?: string;
  bannerUrl?: string;
  timezone: string;
  currency: string;
  plan: ChurchPlan;
  requestedPlan?: ChurchPlan;
  denomination?: string;
  averageWeeklyAttendance?: number;
  ministryPriorities?: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const churchSchema = new Schema<ChurchDocument>(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    // Not known at self-signup — the church fills these in from Settings.
    address: { type: String, default: "" },
    city: { type: String, default: "" },
    country: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, required: true },
    website: { type: String },
    logoUrl: { type: String },
    bannerUrl: { type: String },
    timezone: { type: String, required: true },
    currency: { type: String, required: true },
    plan: {
      type: String,
      enum: ["free", "basic", "pro", "enterprise"],
      default: "free",
    },
    requestedPlan: { type: String, enum: ["free", "basic", "pro", "enterprise"] },
    denomination: { type: String },
    averageWeeklyAttendance: { type: Number },
    ministryPriorities: [{ type: String }],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const ChurchModel =
  mongoose.models.Church ||
  mongoose.model<ChurchDocument>("Church", churchSchema);

function toChurch(doc: ChurchDocument): Church {
  return {
    id: doc._id.toString(),
    name: doc.name,
    slug: doc.slug,
    address: doc.address,
    city: doc.city,
    country: doc.country,
    phone: doc.phone,
    email: doc.email,
    website: doc.website,
    logoUrl: doc.logoUrl,
    bannerUrl: doc.bannerUrl,
    timezone: doc.timezone,
    currency: doc.currency,
    plan: doc.plan,
    requestedPlan: doc.requestedPlan,
    denomination: doc.denomination,
    averageWeeklyAttendance: doc.averageWeeklyAttendance,
    ministryPriorities: doc.ministryPriorities,
    isActive: doc.isActive,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export class MongoChurchRepository implements IChurchRepository {
  async findById(id: string): Promise<Church | null> {
    const doc = await ChurchModel.findById(id);
    return doc ? toChurch(doc as ChurchDocument) : null;
  }

  async findBySlug(slug: string): Promise<Church | null> {
    const doc = await ChurchModel.findOne({ slug });
    return doc ? toChurch(doc as ChurchDocument) : null;
  }

  async findAll(query: PaginationQuery): Promise<PaginatedResult<Church>> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;
    const sortOrder = query.sortOrder === "desc" ? -1 : 1;
    const sortBy = query.sortBy || "createdAt";

    const [docs, total] = await Promise.all([
      ChurchModel.find()
        .sort({ [sortBy]: sortOrder })
        .skip(skip)
        .limit(limit),
      ChurchModel.countDocuments(),
    ]);

    return {
      data: docs.map((d) => toChurch(d as ChurchDocument)),
      total,
    };
  }

  async create(data: CreateChurchData): Promise<Church> {
    const doc = await ChurchModel.create(data);
    return toChurch(doc as ChurchDocument);
  }

  async update(id: string, data: UpdateChurchData): Promise<Church | null> {
    const doc = await ChurchModel.findByIdAndUpdate(id, data, { new: true });
    return doc ? toChurch(doc as ChurchDocument) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await ChurchModel.findByIdAndDelete(id);
    return result !== null;
  }
}
