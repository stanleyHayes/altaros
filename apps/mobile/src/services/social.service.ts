import api from './api';

export interface Post {
  id: string;
  content: string;
  authorId: string;
  authorName: string;
  authorAvatar?: string;
  imageUrl?: string;
  likesCount: number;
  commentsCount: number;
  isLiked: boolean;
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
  imageUrl?: string;
}

const socialService = {
  async getFeed(params?: {
    page?: number;
    limit?: number;
  }): Promise<{ posts: Post[]; total: number }> {
    const { data } = await api.get('/social/feed', { params });
    return data;
  },

  async createPost(post: CreatePostRequest): Promise<Post> {
    const { data } = await api.post<Post>('/social/posts', post);
    return data;
  },

  async likePost(postId: string): Promise<{ likesCount: number }> {
    const { data } = await api.post(`/social/posts/${postId}/like`);
    return data;
  },

  async unlikePost(postId: string): Promise<{ likesCount: number }> {
    const { data } = await api.delete(`/social/posts/${postId}/like`);
    return data;
  },

  async getComments(
    postId: string,
    params?: { page?: number; limit?: number },
  ): Promise<{ comments: Comment[]; total: number }> {
    const { data } = await api.get(`/social/posts/${postId}/comments`, {
      params,
    });
    return data;
  },

  async addComment(
    postId: string,
    content: string,
  ): Promise<Comment> {
    const { data } = await api.post<Comment>(
      `/social/posts/${postId}/comments`,
      { content },
    );
    return data;
  },

  async deletePost(postId: string): Promise<void> {
    await api.delete(`/social/posts/${postId}`);
  },
};

export default socialService;
