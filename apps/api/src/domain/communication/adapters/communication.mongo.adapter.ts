import mongoose, { Schema, type Document } from "mongoose";
import type {
  Message,
  Announcement,
  MessageChannel,
  MessageTargetFilter,
  PaginationQuery,
} from "@altar-os/shared-types";
import type {
  ICommunicationRepository,
  CreateMessageData,
  CreateAnnouncementData,
  UpdateAnnouncementData,
} from "../ports/communication.repository.port.js";
import type { PaginatedResult } from "../../church/ports/church.repository.port.js";

// --- Message Schema ---

interface MessageDocument extends Document {
  churchId: mongoose.Types.ObjectId;
  senderId: mongoose.Types.ObjectId;
  title: string;
  body: string;
  channel: MessageChannel;
  targetFilter?: MessageTargetFilter;
  sentAt?: Date;
  createdAt: Date;
}

const messageSchema = new Schema<MessageDocument>(
  {
    churchId: { type: Schema.Types.ObjectId, ref: "Church", required: true },
    senderId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    channel: {
      type: String,
      enum: ["PUSH", "SMS", "EMAIL"],
      required: true,
    },
    targetFilter: {
      type: Schema.Types.Mixed,
    },
    sentAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

messageSchema.index({ churchId: 1, createdAt: -1 });

const MessageModel =
  mongoose.models.Message ||
  mongoose.model<MessageDocument>("Message", messageSchema);

function toMessage(doc: MessageDocument): Message {
  return {
    id: doc._id.toString(),
    churchId: doc.churchId.toString(),
    senderId: doc.senderId.toString(),
    title: doc.title,
    body: doc.body,
    channel: doc.channel,
    targetFilter: doc.targetFilter,
    sentAt: doc.sentAt,
    createdAt: doc.createdAt,
  };
}

// --- Announcement Schema ---

interface AnnouncementDocument extends Document {
  churchId: mongoose.Types.ObjectId;
  title: string;
  body: string;
  imageUrl?: string;
  isPinned: boolean;
  expiresAt?: Date;
  createdAt: Date;
}

const announcementSchema = new Schema<AnnouncementDocument>(
  {
    churchId: { type: Schema.Types.ObjectId, ref: "Church", required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    imageUrl: { type: String },
    isPinned: { type: Boolean, default: false },
    expiresAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

announcementSchema.index({ churchId: 1, createdAt: -1 });

const AnnouncementModel =
  mongoose.models.Announcement ||
  mongoose.model<AnnouncementDocument>("Announcement", announcementSchema);

function toAnnouncement(doc: AnnouncementDocument): Announcement {
  return {
    id: doc._id.toString(),
    churchId: doc.churchId.toString(),
    title: doc.title,
    body: doc.body,
    imageUrl: doc.imageUrl,
    isPinned: doc.isPinned,
    expiresAt: doc.expiresAt,
    createdAt: doc.createdAt,
  };
}

// --- Repository ---

export class MongoCommunicationRepository
  implements ICommunicationRepository
{
  async createMessage(data: CreateMessageData): Promise<Message> {
    const doc = await MessageModel.create({
      ...data,
      sentAt: new Date(),
    });
    return toMessage(doc as MessageDocument);
  }

  async findMessagesByChurchId(
    churchId: string,
    query: PaginationQuery,
  ): Promise<PaginatedResult<Message>> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const [docs, total] = await Promise.all([
      MessageModel.find({ churchId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      MessageModel.countDocuments({ churchId }),
    ]);

    return {
      data: docs.map((d) => toMessage(d as MessageDocument)),
      total,
    };
  }

  async findMessageById(id: string): Promise<Message | null> {
    const doc = await MessageModel.findById(id);
    return doc ? toMessage(doc as MessageDocument) : null;
  }

  async createAnnouncement(
    data: CreateAnnouncementData,
  ): Promise<Announcement> {
    const doc = await AnnouncementModel.create(data);
    return toAnnouncement(doc as AnnouncementDocument);
  }

  async findAnnouncementsByChurchId(
    churchId: string,
    query: PaginationQuery,
  ): Promise<PaginatedResult<Announcement>> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const [docs, total] = await Promise.all([
      AnnouncementModel.find({ churchId })
        .sort({ isPinned: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit),
      AnnouncementModel.countDocuments({ churchId }),
    ]);

    return {
      data: docs.map((d) => toAnnouncement(d as AnnouncementDocument)),
      total,
    };
  }

  async findAnnouncementById(id: string): Promise<Announcement | null> {
    const doc = await AnnouncementModel.findById(id);
    return doc ? toAnnouncement(doc as AnnouncementDocument) : null;
  }

  async updateAnnouncement(
    id: string,
    data: UpdateAnnouncementData,
  ): Promise<Announcement | null> {
    const doc = await AnnouncementModel.findByIdAndUpdate(id, data, {
      new: true,
    });
    return doc ? toAnnouncement(doc as AnnouncementDocument) : null;
  }

  async deleteAnnouncement(id: string): Promise<boolean> {
    const result = await AnnouncementModel.findByIdAndDelete(id);
    return result !== null;
  }
}
