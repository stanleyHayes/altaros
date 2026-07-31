import mongoose, { Schema, type Document } from "mongoose";
import type { Member, MemberStatus } from "@altar-os/shared-types";
import type {
  IMemberRepository,
  CreateMemberData,
  UpdateMemberData,
  MemberSearchQuery,
} from "../ports/member.repository.port.js";
import type { PaginatedResult } from "../../church/ports/church.repository.port.js";

interface MemberDocument extends Document {
  churchId: mongoose.Types.ObjectId;
  userId?: mongoose.Types.ObjectId;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  dateOfBirth?: Date;
  gender?: string;
  address?: string;
  familyId?: mongoose.Types.ObjectId;
  departmentIds: mongoose.Types.ObjectId[];
  status: MemberStatus;
  joinDate: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const memberSchema = new Schema<MemberDocument>(
  {
    churchId: { type: Schema.Types.ObjectId, ref: "Church", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, lowercase: true },
    phone: { type: String },
    dateOfBirth: { type: Date },
    gender: { type: String },
    address: { type: String },
    familyId: { type: Schema.Types.ObjectId, ref: "Family" },
    departmentIds: [{ type: Schema.Types.ObjectId }],
    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE", "VISITOR", "TRANSFERRED"],
      default: "ACTIVE",
    } as unknown as typeof Schema.Types.String,
    joinDate: { type: Date, default: Date.now },
    notes: { type: String },
  },
  { timestamps: true },
);

memberSchema.index({ churchId: 1, status: 1 });
memberSchema.index({ familyId: 1 });
memberSchema.index({ firstName: "text", lastName: "text", email: "text" });

const MemberModel =
  mongoose.models.Member ||
  mongoose.model<MemberDocument>("Member", memberSchema);

function toMember(doc: MemberDocument): Member {
  return {
    id: doc._id.toString(),
    churchId: doc.churchId.toString(),
    userId: doc.userId?.toString(),
    firstName: doc.firstName,
    lastName: doc.lastName,
    email: doc.email,
    phone: doc.phone,
    dateOfBirth: doc.dateOfBirth,
    gender: doc.gender,
    address: doc.address,
    familyId: doc.familyId?.toString(),
    departmentIds: doc.departmentIds.map((d) => d.toString()),
    status: doc.status,
    joinDate: doc.joinDate,
    notes: doc.notes,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export class MongoMemberRepository implements IMemberRepository {
  async findById(id: string): Promise<Member | null> {
    const doc = await MemberModel.findById(id);
    return doc ? toMember(doc as MemberDocument) : null;
  }

  async findByChurchId(
    churchId: string,
    query: MemberSearchQuery,
  ): Promise<PaginatedResult<Member>> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;
    const sortOrder = query.sortOrder === "desc" ? -1 : 1;
    const sortBy = query.sortBy || "createdAt";

    const filter: Record<string, unknown> = { churchId };

    if (query.status) {
      filter.status = query.status;
    }

    if (query.search) {
      filter.$or = [
        { firstName: { $regex: query.search, $options: "i" } },
        { lastName: { $regex: query.search, $options: "i" } },
        { email: { $regex: query.search, $options: "i" } },
      ];
    }

    const [docs, total] = await Promise.all([
      MemberModel.find(filter)
        .sort({ [sortBy]: sortOrder })
        .skip(skip)
        .limit(limit),
      MemberModel.countDocuments(filter),
    ]);

    return {
      data: docs.map((d) => toMember(d as MemberDocument)),
      total,
    };
  }

  async findByFamilyId(familyId: string): Promise<Member[]> {
    const docs = await MemberModel.find({ familyId });
    return docs.map((d) => toMember(d as MemberDocument));
  }

  async create(data: CreateMemberData): Promise<Member> {
    const doc = await MemberModel.create(data);
    return toMember(doc as MemberDocument);
  }

  async update(id: string, data: UpdateMemberData): Promise<Member | null> {
    const doc = await MemberModel.findByIdAndUpdate(id, data, { new: true });
    return doc ? toMember(doc as MemberDocument) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await MemberModel.findByIdAndDelete(id);
    return result !== null;
  }

  async countByChurchId(churchId: string): Promise<number> {
    return MemberModel.countDocuments({ churchId });
  }
}
