import api from './api';
import socialService, { normalizeComment, normalizePost } from './social.service';

jest.mock('./api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

const mockedApi = api as jest.Mocked<typeof api>;

describe('social service contracts', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects an unsafe post route before transport', async () => {
    await expect(socialService.getComments('post/unsafe', { limit: 50 }))
      .rejects.toThrow('reference is not valid');
    expect(mockedApi.get).not.toHaveBeenCalled();
  });

  it('normalizes the shared feed envelope and author/reaction field names', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: {
      data: [{
        id: 'post-1', churchId: 'church-1', content: 'God is good', type: 'testimony', authorId: 'member-1', authorName: 'Ama',
        authorAvatarUrl: 'https://cdn.example/avatar.jpg', likesCount: 4, commentsCount: 1,
        isLikedByMe: true, createdAt: '2026-08-01T00:00:00Z',
      }],
      total: 1,
    } } as never);

    const result = await socialService.getFeed('church-1', { limit: 30 });
    expect(result.posts[0]).toMatchObject({
      type: 'testimony', authorAvatar: 'https://cdn.example/avatar.jpg', isLiked: true,
      reactionStatusKnown: true,
    });
  });

  it('keeps a missing member reaction distinct from a confirmed unliked state', () => {
    const base = {
      id: 'post-1', churchId: 'church-1', content: 'Hello', authorId: 'member-1',
      authorName: 'Ama', likesCount: 0, commentsCount: 0, createdAt: '2026-08-01T00:00:00Z',
    };
    expect(normalizePost(base, 'church-1')).toMatchObject({
      isLiked: false, reactionStatusKnown: false,
    });
    expect(normalizePost({ ...base, isLikedByMe: false }, 'church-1')).toMatchObject({
      isLiked: false, reactionStatusKnown: true,
    });
  });

  it('normalizes a shared comment array and avatar field', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [{
      id: 'comment-1', postId: 'post-1', content: 'Amen', authorId: 'member-1', authorName: 'Ama',
      authorAvatarUrl: 'https://cdn.example/avatar.jpg', createdAt: '2026-08-01T00:00:00Z',
    }] } as never);

    await expect(socialService.getComments('post-1')).resolves.toMatchObject({
      comments: [{ authorAvatar: 'https://cdn.example/avatar.jpg' }], total: 1,
    });
  });

  it('keeps intentional line breaks in bounded community copy', () => {
    expect(normalizePost({
      id: 'post-1', churchId: 'church-1', content: 'First line\nSecond line', authorId: 'member-1',
      authorName: 'Ama', likesCount: 0, commentsCount: 0, createdAt: '2026-08-01T00:00:00Z',
    }, 'church-1').content).toBe('First line\nSecond line');
  });

  it('sends the shared post type and tolerates a count-less reaction response', async () => {
    mockedApi.post
      .mockResolvedValueOnce({ data: {
        success: true,
        data: {
          id: 'post-1', churchId: 'church-1', content: 'A testimony', type: 'testimony', authorId: 'member-1', authorName: 'Ama',
          likesCount: 0, commentsCount: 0, createdAt: '2026-08-01T00:00:00Z',
        },
      } } as never)
      .mockResolvedValueOnce({ data: undefined } as never);

    await socialService.createPost({
      content: ' A testimony ', type: 'testimony', injectedChurchId: 'other-church',
    } as never, 'church-1', 'member-1');
    expect(mockedApi.post).toHaveBeenNthCalledWith(1, '/social/posts', { content: 'A testimony', type: 'testimony' });
    await expect(socialService.likePost('post-1')).resolves.toEqual({});
  });

  it('trims and posts a comment to the selected post', async () => {
    const comment = { id: 'comment-1', postId: 'post-1', content: 'Amen', authorId: 'member-1', authorName: 'Ama', createdAt: '2026-08-01T00:00:00Z' };
    mockedApi.post.mockResolvedValueOnce({ data: comment } as never);

    await expect(socialService.addComment('post-1', '  Amen  ', 'member-1')).resolves.toEqual(comment);
    expect(mockedApi.post).toHaveBeenCalledWith('/social/posts/post-1/comments', { content: 'Amen' });
  });

  it.each([
    { authorId: 'member-2' },
    { content: 'Changed by server' },
    { type: 'general' },
  ])('rejects a create-post acknowledgement that changes member intent: %p', async (override) => {
    mockedApi.post.mockResolvedValueOnce({ data: {
      id: 'post-1', churchId: 'church-1', content: 'A testimony', type: 'testimony',
      authorId: 'member-1', authorName: 'Ama', likesCount: 0, commentsCount: 0,
      createdAt: '2026-08-01T00:00:00Z', ...override,
    } } as never);
    await expect(socialService.createPost(
      { content: 'A testimony', type: 'testimony' }, 'church-1', 'member-1',
    )).rejects.toThrow('invalid community post');
  });

  it.each([
    { authorId: 'member-2' },
    { content: 'Changed by server' },
  ])('rejects a comment acknowledgement that changes member intent: %p', async (override) => {
    mockedApi.post.mockResolvedValueOnce({ data: {
      id: 'comment-1', postId: 'post-1', content: 'Amen', authorId: 'member-1',
      authorName: 'Ama', createdAt: '2026-08-01T00:00:00Z', ...override,
    } } as never);
    await expect(socialService.addComment('post-1', 'Amen', 'member-1'))
      .rejects.toThrow('invalid comment');
  });

  it.each([
    { id: 'post-1', churchId: 'other-church', content: 'Cross tenant', authorId: 'member-1', authorName: 'Ama', likesCount: 0, commentsCount: 0, createdAt: '2026-08-01T00:00:00Z' },
    { id: 'post-1', churchId: 'church-1', content: '', authorId: 'member-1', authorName: 'Ama', likesCount: 0, commentsCount: 0, createdAt: '2026-08-01T00:00:00Z' },
    { id: 'post-1', churchId: 'church-1', content: 'Hello', authorId: 'member-1', authorName: 'Ama', likesCount: -1, commentsCount: 0, createdAt: '2026-08-01T00:00:00Z' },
    { id: 'post-1', churchId: 'church-1', content: 'Hello', authorId: 'member-1', authorName: 'Ama', likesCount: 0, commentsCount: 0, createdAt: 'not-a-date' },
    { id: 'post-1', churchId: 'church-1', content: 'Hello', type: 'announcement', authorId: 'member-1', authorName: 'Ama', likesCount: 0, commentsCount: 0, createdAt: '2026-08-01T00:00:00Z' },
  ])('rejects malformed or cross-church posts', (post) => {
    expect(() => normalizePost(post, 'church-1')).toThrow('invalid community post');
  });

  it('rejects a comment attached to a different post', () => {
    expect(() => normalizeComment({
      id: 'comment-1', postId: 'post-2', content: 'Amen', authorId: 'member-1',
      authorName: 'Ama', createdAt: '2026-08-01T00:00:00Z',
    }, 'post-1')).toThrow('invalid comment');
  });

  it.each([-1, 1.5, Number.NaN])('rejects an unsafe reaction count %s', async (likesCount) => {
    mockedApi.post.mockResolvedValueOnce({ data: { likesCount } } as never);
    await expect(socialService.likePost('post-1')).rejects.toThrow('invalid reaction count');
  });

  it('rejects duplicate post identifiers before FlatList receives unstable keys', async () => {
    const post = {
      id: 'post-1', churchId: 'church-1', content: 'Hello', authorId: 'member-1',
      authorName: 'Ama', likesCount: 0, commentsCount: 0, createdAt: '2026-08-01T00:00:00Z',
    };
    mockedApi.get.mockResolvedValueOnce({ data: { data: [post, post], total: 2 } } as never);
    await expect(socialService.getFeed('church-1')).rejects.toThrow('duplicate community posts');
  });

  it.each([
    ['post content', { id: 'post-1', churchId: 'church-1', content: 'x'.repeat(501), authorId: 'member-1', authorName: 'Ama', likesCount: 0, commentsCount: 0, createdAt: '2026-08-01T00:00:00Z' }],
    ['author name', { id: 'post-1', churchId: 'church-1', content: 'Hello', authorId: 'member-1', authorName: 'x'.repeat(121), likesCount: 0, commentsCount: 0, createdAt: '2026-08-01T00:00:00Z' }],
    ['identifier', { id: 'post/unsafe', churchId: 'church-1', content: 'Hello', authorId: 'member-1', authorName: 'Ama', likesCount: 0, commentsCount: 0, createdAt: '2026-08-01T00:00:00Z' }],
    ['media URL', { id: 'post-1', churchId: 'church-1', content: 'Hello', authorId: 'member-1', authorName: 'Ama', imageUrl: 'https://user:secret@cdn.example/image.jpg', likesCount: 0, commentsCount: 0, createdAt: '2026-08-01T00:00:00Z' }],
  ])('rejects an unsafe or oversized %s', (_label, post) => {
    expect(() => normalizePost(post, 'church-1')).toThrow('invalid community post');
  });

  it('rejects an oversized feed response even when its reported total is valid', async () => {
    const post = (id: string) => ({
      id, churchId: 'church-1', content: 'Hello', authorId: 'member-1',
      authorName: 'Ama', likesCount: 0, commentsCount: 0, createdAt: '2026-08-01T00:00:00Z',
    });
    mockedApi.get.mockResolvedValueOnce({ data: { data: [post('post-1'), post('post-2')], total: 2 } } as never);
    await expect(socialService.getFeed('church-1', { limit: 1 })).rejects.toThrow('too many community posts');
  });

  it('rejects malformed pagination before sending a request', async () => {
    await expect(socialService.getComments('post-1', { page: 0, limit: 101 })).rejects.toThrow('community page');
    expect(mockedApi.get).not.toHaveBeenCalled();
  });

  it('rejects oversized comment input before sending a request', async () => {
    await expect(socialService.addComment('post-1', 'x'.repeat(501), 'member-1')).rejects.toThrow('comment is invalid');
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it.each([
    () => socialService.getFeed('church/unsafe'),
    () => socialService.likePost('post/unsafe'),
    () => socialService.unlikePost('post/unsafe'),
    () => socialService.deletePost('post/unsafe'),
    () => socialService.addComment('post-1', 'Amen', 'member/unsafe'),
  ])('rejects an unsafe community route identity before transport', async (request) => {
    await expect(request()).rejects.toThrow();
    expect(mockedApi.get).not.toHaveBeenCalled();
    expect(mockedApi.post).not.toHaveBeenCalled();
    expect(mockedApi.delete).not.toHaveBeenCalled();
  });
});
