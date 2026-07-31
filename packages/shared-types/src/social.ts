export type PostType = "general" | "testimony" | "praise_report";

export interface SocialPost {
  id: string;
  churchId: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl?: string;
  content: string;
  type: PostType;
  imageUrl?: string;
  likesCount: number;
  commentsCount: number;
  createdAt: Date;
}

export interface SocialComment {
  id: string;
  postId: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl?: string;
  content: string;
  createdAt: Date;
}
