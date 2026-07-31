import { get, post, del } from "./api";

export type PostType = "general" | "testimony" | "praise_report";

export interface SocialPost {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl?: string;
  content: string;
  type: PostType;
  imageUrl?: string;
  likesCount: number;
  commentsCount: number;
  isLikedByMe: boolean;
  createdAt: string;
}

export interface Comment {
  id: string;
  postId: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl?: string;
  content: string;
  createdAt: string;
}

export interface CreatePostPayload {
  content: string;
  type: PostType;
  imageUrl?: string;
}

const SocialService = {
  async getFeed(page = 1): Promise<{ data: SocialPost[]; total: number }> {
    // TODO: Replace with actual API call
    return get(`/social/feed?page=${page}`);
  },

  async createPost(payload: CreatePostPayload): Promise<SocialPost> {
    // TODO: Replace with actual API call
    return post<SocialPost>("/social/posts", payload);
  },

  async likePost(postId: string): Promise<void> {
    // TODO: Replace with actual API call
    return post(`/social/posts/${postId}/like`);
  },

  async unlikePost(postId: string): Promise<void> {
    // TODO: Replace with actual API call
    return del(`/social/posts/${postId}/like`);
  },

  async getComments(postId: string): Promise<Comment[]> {
    // TODO: Replace with actual API call
    return get<Comment[]>(`/social/posts/${postId}/comments`);
  },

  async addComment(postId: string, content: string): Promise<Comment> {
    // TODO: Replace with actual API call
    return post<Comment>(`/social/posts/${postId}/comments`, { content });
  },
};

export default SocialService;
