import { post, get } from "./api";
import type {
  PrayerChatMessage,
  PrayerChatResponse,
} from "@altar-os/shared-types";

interface ApiWrapped<T> {
  success: boolean;
  data: T;
  message?: string;
}

const AiService = {
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
