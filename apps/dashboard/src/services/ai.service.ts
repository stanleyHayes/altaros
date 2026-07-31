import { get, post, put } from "./api";
import type {
  SermonOutline,
  SermonGenerateRequest,
  MemberInsight,
  PrayerChatMessage,
  PrayerChatResponse,
} from "@altar-os/shared-types";

interface ApiWrapped<T> {
  success: boolean;
  data: T;
  message?: string;
}

const AiService = {
  async generateSermon(
    request: SermonGenerateRequest,
  ): Promise<SermonOutline> {
    const res = await post<ApiWrapped<SermonOutline>>(
      "/ai/sermons/generate",
      request,
    );
    return res.data;
  },

  async getSermons(): Promise<SermonOutline[]> {
    const res = await get<ApiWrapped<SermonOutline[]>>("/ai/sermons");
    return res.data;
  },

  async getSermonById(id: string): Promise<SermonOutline> {
    const res = await get<ApiWrapped<SermonOutline>>(`/ai/sermons/${id}`);
    return res.data;
  },

  async getInsights(): Promise<MemberInsight[]> {
    const res = await get<ApiWrapped<MemberInsight[]>>("/ai/insights");
    return res.data;
  },

  async dismissInsight(id: string): Promise<void> {
    await put<ApiWrapped<null>>(`/ai/insights/${id}/dismiss`);
  },

  async prayerChat(
    message: string,
    conversationId?: string,
  ): Promise<PrayerChatResponse> {
    const res = await post<ApiWrapped<PrayerChatResponse>>("/ai/prayer/chat", {
      message,
      conversationId,
    });
    return res.data;
  },

  async getPrayerHistory(conversationId: string): Promise<PrayerChatMessage[]> {
    const res = await get<ApiWrapped<PrayerChatMessage[]>>(
      `/ai/prayer/${conversationId}`,
    );
    return res.data;
  },
};

export default AiService;
