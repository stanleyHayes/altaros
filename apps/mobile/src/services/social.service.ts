import api from './api';
import { unwrapApiData } from './api-envelope';

export type PostType = 'general' | 'testimony' | 'praise_report';
export type ReportReason = 'spam' | 'harassment' | 'misleading' | 'inappropriate' | 'privacy';

export interface Post {
  id: string;
  churchId: string;
  content: string;
  authorId: string;
  authorName: string;
  authorAvatar?: string;
  imageUrl?: string;
  type: PostType;
  likesCount: number;
  commentsCount: number;
  isLiked: boolean;
  reactionStatusKnown: boolean;
  createdAt: string;
}

export interface Comment {
  id: string;
  postId: string;
  content: string;
  authorId: string;
  authorName: string;
  authorAvatar?: string;
  createdAt: string;
}

export interface CreatePostRequest {
  content: string;
  type: PostType;
  imageUrl?: string;
}

interface WirePost extends Omit<Post, 'authorAvatar' | 'isLiked' | 'reactionStatusKnown' | 'type'> {
  authorAvatar?: string;
  authorAvatarUrl?: string;
  isLiked?: boolean;
  isLikedByMe?: boolean;
  type?: PostType;
}

interface WireComment extends Omit<Comment, 'authorAvatar'> {
  authorAvatar?: string;
  authorAvatarUrl?: string;
}

const POST_TYPES = new Set<PostType>(['general', 'testimony', 'praise_report']);
const REPORT_REASONS = new Set<ReportReason>(['spam', 'harassment', 'misleading', 'inappropriate', 'privacy']);
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 100;
const MAX_ID_LENGTH = 128;
const MAX_CONTENT_LENGTH = 500;
const MAX_AUTHOR_NAME_LENGTH = 120;
const MAX_MEDIA_URL_LENGTH = 2048;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function boundedText(value: unknown, maxLength: number, allowLineBreaks = false): value is string {
  const unsafeControls = allowLineBreaks
    ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/
    : /[\u0000-\u001F\u007F]/;
  return nonEmptyString(value)
    && value.length <= maxLength
    && !unsafeControls.test(value);
}

function validId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= MAX_ID_LENGTH
    && SAFE_ID.test(value);
}

function safeMediaUrl(value: unknown): value is string | undefined {
  if (value === undefined) return true;
  if (typeof value !== 'string' || value.length > MAX_MEDIA_URL_LENGTH || /[\u0000-\u001F\u007F]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function validCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function requestedPageSize(params?: { page?: number; limit?: number }): number {
  if (params?.page !== undefined && (!Number.isSafeInteger(params.page) || params.page < 1)) {
    throw new Error('The requested community page is invalid.');
  }
  if (params?.limit !== undefined && (!Number.isSafeInteger(params.limit) || params.limit < 1 || params.limit > MAX_PAGE_SIZE)) {
    throw new Error('The requested community page size is invalid.');
  }
  return params?.limit ?? DEFAULT_PAGE_SIZE;
}

export function normalizePost(value: unknown, expectedChurchId?: string): Post {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The server returned an invalid community post.');
  }
  const post = value as Partial<WirePost>;
  const type = post.type ?? 'general';
  const liked = post.isLikedByMe ?? post.isLiked ?? false;
  const reactionStatusKnown = post.isLikedByMe !== undefined || post.isLiked !== undefined;
  const valid = validId(post.id)
    && validId(post.churchId)
    && (!expectedChurchId || post.churchId === expectedChurchId)
    && boundedText(post.content, MAX_CONTENT_LENGTH, true)
    && validId(post.authorId)
    && boundedText(post.authorName, MAX_AUTHOR_NAME_LENGTH)
    && safeMediaUrl(post.authorAvatar)
    && safeMediaUrl(post.authorAvatarUrl)
    && safeMediaUrl(post.imageUrl)
    && POST_TYPES.has(type)
    && validCount(post.likesCount)
    && validCount(post.commentsCount)
    && typeof liked === 'boolean'
    && validDate(post.createdAt);
  if (!valid) throw new Error('The server returned an invalid community post.');
  const wire = post as WirePost;
  return {
    id: wire.id,
    churchId: wire.churchId,
    content: wire.content,
    authorId: wire.authorId,
    authorName: wire.authorName,
    ...(wire.authorAvatarUrl ?? wire.authorAvatar
      ? { authorAvatar: wire.authorAvatarUrl ?? wire.authorAvatar }
      : {}),
    ...(wire.imageUrl ? { imageUrl: wire.imageUrl } : {}),
    type,
    likesCount: wire.likesCount,
    commentsCount: wire.commentsCount,
    isLiked: liked,
    reactionStatusKnown,
    createdAt: wire.createdAt,
  };
}

export function normalizeComment(value: unknown, expectedPostId: string): Comment {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The server returned an invalid comment.');
  }
  const comment = value as Partial<WireComment>;
  const valid = validId(comment.id)
    && comment.postId === expectedPostId
    && validId(comment.postId)
    && boundedText(comment.content, MAX_CONTENT_LENGTH, true)
    && validId(comment.authorId)
    && boundedText(comment.authorName, MAX_AUTHOR_NAME_LENGTH)
    && safeMediaUrl(comment.authorAvatar)
    && safeMediaUrl(comment.authorAvatarUrl)
    && validDate(comment.createdAt);
  if (!valid) throw new Error('The server returned an invalid comment.');
  const wire = comment as WireComment;
  return {
    id: wire.id,
    postId: wire.postId,
    content: wire.content,
    authorId: wire.authorId,
    authorName: wire.authorName,
    ...(wire.authorAvatarUrl ?? wire.authorAvatar
      ? { authorAvatar: wire.authorAvatarUrl ?? wire.authorAvatar }
      : {}),
    createdAt: wire.createdAt,
  };
}

function normalizeReaction(value: unknown): { likesCount?: number } {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The server returned an invalid reaction count.');
  }
  const likesCount = (value as { likesCount?: unknown }).likesCount;
  if (likesCount === undefined) return {};
  if (!validCount(likesCount)) throw new Error('The server returned an invalid reaction count.');
  return { likesCount };
}

const socialService = {
  async getFeed(churchId: string, params?: {
    page?: number;
    limit?: number;
  }): Promise<{ posts: Post[]; total: number }> {
    if (!validId(churchId)) throw new Error('The member identity is incomplete.');
    const pageSize = requestedPageSize(params);
    const { data } = await api.get<unknown>('/social/feed', { params });
    const payload = unwrapApiData(data, 'The server returned an invalid community feed.');
    const posts = Array.isArray(payload)
      ? payload
      : typeof payload === 'object' && payload !== null
        ? (payload as { posts?: WirePost[]; data?: WirePost[] }).posts
          ?? (payload as { data?: WirePost[] }).data
        : undefined;
    if (!Array.isArray(posts)) throw new Error('The server returned an invalid community feed.');
    if (posts.length > pageSize) throw new Error('The server returned too many community posts.');
    const normalized = posts.map((post) => normalizePost(post, churchId));
    if (new Set(normalized.map((post) => post.id)).size !== normalized.length) {
      throw new Error('The server returned duplicate community posts.');
    }
    const total = Array.isArray(payload)
      ? normalized.length
      : (payload as { total?: number }).total ?? normalized.length;
    if (!validCount(total) || total < normalized.length) {
      throw new Error('The server returned an invalid community total.');
    }
    return { posts: normalized, total };
  },

  async createPost(post: CreatePostRequest, churchId: string, memberId: string): Promise<Post> {
    if (typeof post !== 'object' || post === null) throw new Error('The community post is invalid.');
    const content = typeof post?.content === 'string' ? post.content.trim() : '';
    if (!validId(churchId) || !validId(memberId)) throw new Error('The member identity is incomplete.');
    if (!boundedText(content, MAX_CONTENT_LENGTH, true) || !POST_TYPES.has(post.type) || !safeMediaUrl(post.imageUrl)) {
      throw new Error('The community post is invalid.');
    }
    const request: CreatePostRequest = {
      content,
      type: post.type,
      ...(post.imageUrl ? { imageUrl: post.imageUrl } : {}),
    };
    const { data } = await api.post<unknown>('/social/posts', request);
    const created = normalizePost(unwrapApiData(data, 'The server returned an invalid community post.'), churchId);
    if (created.authorId !== memberId || created.content !== content || created.type !== post.type) {
      throw new Error('The server returned an invalid community post.');
    }
    return created;
  },

  async likePost(postId: string): Promise<{ likesCount?: number }> {
    if (!validId(postId)) throw new Error('The community post reference is not valid.');
    const { data } = await api.post<unknown>(`/social/posts/${encodeURIComponent(postId)}/like`);
    return normalizeReaction(unwrapApiData(data, 'The server returned an invalid reaction count.'));
  },

  async unlikePost(postId: string): Promise<{ likesCount?: number }> {
    if (!validId(postId)) throw new Error('The community post reference is not valid.');
    const { data } = await api.delete<unknown>(`/social/posts/${encodeURIComponent(postId)}/like`);
    return normalizeReaction(unwrapApiData(data, 'The server returned an invalid reaction count.'));
  },

  async getComments(
    postId: string,
    params?: { page?: number; limit?: number },
  ): Promise<{ comments: Comment[]; total: number }> {
    if (!validId(postId)) throw new Error('The community post reference is not valid.');
    const pageSize = requestedPageSize(params);
    const { data } = await api.get<unknown>(`/social/posts/${encodeURIComponent(postId)}/comments`, {
      params,
    });
    const payload = unwrapApiData(data, 'The server returned invalid comments.');
    const comments = Array.isArray(payload)
      ? payload
      : typeof payload === 'object' && payload !== null
        ? (payload as { comments?: WireComment[]; data?: WireComment[] }).comments
          ?? (payload as { data?: WireComment[] }).data
        : undefined;
    if (!Array.isArray(comments)) throw new Error('The server returned invalid comments.');
    if (comments.length > pageSize) throw new Error('The server returned too many comments.');
    const normalized = comments.map((comment) => normalizeComment(comment, postId));
    if (new Set(normalized.map((comment) => comment.id)).size !== normalized.length) {
      throw new Error('The server returned duplicate comments.');
    }
    const total = Array.isArray(payload)
      ? normalized.length
      : (payload as { total?: number }).total ?? normalized.length;
    if (!validCount(total) || total < normalized.length) throw new Error('The server returned an invalid comment total.');
    return { comments: normalized, total };
  },

  async addComment(
    postId: string,
    content: string,
    memberId: string,
  ): Promise<Comment> {
    const normalizedContent = content.trim();
    if (!validId(postId)) throw new Error('The community post reference is not valid.');
    if (!validId(memberId)) throw new Error('The member identity is incomplete.');
    if (!boundedText(normalizedContent, MAX_CONTENT_LENGTH, true)) throw new Error('The comment is invalid.');
    const { data } = await api.post<unknown>(
      `/social/posts/${encodeURIComponent(postId)}/comments`,
      { content: normalizedContent },
    );
    const created = normalizeComment(unwrapApiData(data, 'The server returned an invalid comment.'), postId);
    if (created.authorId !== memberId || created.content !== normalizedContent) {
      throw new Error('The server returned an invalid comment.');
    }
    return created;
  },

  async reportPost(postId: string, reason: ReportReason): Promise<void> {
    if (!validId(postId)) throw new Error('The community post reference is not valid.');
    if (!REPORT_REASONS.has(reason)) throw new Error('Choose a valid reason for this report.');
    const { data } = await api.post<unknown>(
      `/social/posts/${encodeURIComponent(postId)}/report`,
      { reason, detail: '' },
    );
    const acknowledgement = unwrapApiData(data, 'The server did not confirm this report.');
    if (typeof acknowledgement !== 'object' || acknowledgement === null || Array.isArray(acknowledgement)
      || (acknowledgement as { reported?: unknown }).reported !== true
      || !validId((acknowledgement as { reportId?: unknown }).reportId)) {
      throw new Error('The server did not confirm this report.');
    }
  },

  async deleteComment(postId: string, commentId: string): Promise<void> {
    if (!validId(postId) || !validId(commentId)) throw new Error('The community comment reference is not valid.');
    const { data } = await api.delete<unknown>(
      `/social/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}`,
    );
    const acknowledgement = unwrapApiData(data, 'The server did not confirm this comment was deleted.');
    if (typeof acknowledgement !== 'object' || acknowledgement === null || Array.isArray(acknowledgement)
      || (acknowledgement as { deleted?: unknown }).deleted !== true) {
      throw new Error('The server did not confirm this comment was deleted.');
    }
  },

  async deletePost(postId: string): Promise<void> {
    if (!validId(postId)) throw new Error('The community post reference is not valid.');
    const { data } = await api.delete<unknown>(`/social/posts/${encodeURIComponent(postId)}`);
    const acknowledgement = unwrapApiData(data, 'The server did not confirm this post was deleted.');
    if (typeof acknowledgement !== 'object' || acknowledgement === null || Array.isArray(acknowledgement)
      || (acknowledgement as { deleted?: unknown }).deleted !== true) {
      throw new Error('The server did not confirm this post was deleted.');
    }
  },
};

export default socialService;
