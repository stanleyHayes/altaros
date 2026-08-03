import api from './api';
import { AxiosError, AxiosHeaders } from 'axios';
import spiritualService, {
  normalizeDevotional,
  normalizePrayerRequest,
  normalizeSermon,
  safeSpiritualMediaUrl,
  sermonPlaybackAction,
} from './spiritual.service';

jest.mock('./api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

const mockedApi = api as jest.Mocked<typeof api>;

const responseError = (status: number) => new AxiosError(
  'Request failed',
  'ERR_BAD_RESPONSE',
  undefined,
  undefined,
  { status, statusText: '', headers: {}, config: { headers: new AxiosHeaders() }, data: {} },
);

describe('spiritual service contracts', () => {
  beforeEach(() => jest.clearAllMocks());

  it('maps shared devotional scripture reference and text into the reading UI model', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: {
      id: 'devotional-1', churchId: 'church-1', title: 'Grace', scripture: 'Ephesians 2:8',
      scriptureText: 'For it is by grace you have been saved.', content: 'Reflect on grace.',
      author: 'Pastor Ama', date: '2026-08-01T00:00:00Z',
    } } as never);

    await expect(spiritualService.getTodayDevotional('church-1')).resolves.toMatchObject({
      scripture: 'For it is by grace you have been saved.', scriptureReference: 'Ephesians 2:8',
    });
  });

  it('retains compatibility with the earlier mobile devotional field names', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: {
      id: 'devotional-1', churchId: 'church-1', title: 'Grace', scripture: 'For it is by grace you have been saved.',
      scriptureReference: 'Ephesians 2:8', content: 'Reflect on grace.', author: 'Pastor Ama', date: '1 Aug 2026',
    } } as never);

    await expect(spiritualService.getTodayDevotional('church-1')).resolves.toMatchObject({
      scripture: 'For it is by grace you have been saved.', scriptureReference: 'Ephesians 2:8',
    });
  });

  it('treats an authoritative missing daily devotional as an empty editorial state', async () => {
    mockedApi.get.mockRejectedValueOnce(responseError(404));
    await expect(spiritualService.getTodayDevotional('church-1')).resolves.toBeNull();
  });

  it('does not disguise a devotional service failure as an unpublished reading', async () => {
    mockedApi.get.mockRejectedValueOnce(responseError(503));
    await expect(spiritualService.getTodayDevotional('church-1')).rejects.toBeInstanceOf(AxiosError);
  });

  it('loads the bounded community prayer page', async () => {
    const page = { data: [], total: 0 };
    mockedApi.get.mockResolvedValueOnce({ data: page } as never);

    await expect(spiritualService.getPrayerRequests('church-1', { limit: 30 })).resolves.toEqual({ requests: [], total: 0 });
    expect(mockedApi.get).toHaveBeenCalledWith('/spiritual/prayer-requests', {
      params: { limit: 30 },
    });
  });

  it('requests an explicit prayer page and retains the authoritative total', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { requests: [], total: 84 } } as never);

    await expect(spiritualService.getPrayerRequests('church-1', { page: 2, limit: 25 }))
      .resolves.toEqual({ requests: [], total: 84 });
    expect(mockedApi.get).toHaveBeenCalledWith('/spiritual/prayer-requests', {
      params: { page: 2, limit: 25 },
    });
  });

  it('normalizes a shared prayer array and missing prayer count', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [{
      id: 'prayer-1', churchId: 'church-1', memberId: 'member-1', title: 'Family', description: 'Please pray with us.',
      isAnonymous: true, createdAt: '2026-08-01T00:00:00Z',
    }] } as never);

    await expect(spiritualService.getPrayerRequests('church-1')).resolves.toMatchObject({
      requests: [{ id: 'prayer-1', prayerCount: 0 }], total: 1,
    });
  });

  it('loads a bounded sermon collection', async () => {
    const page = { data: [], total: 0 };
    mockedApi.get.mockResolvedValueOnce({ data: page } as never);

    await expect(spiritualService.getSermons('church-1', { limit: 40 })).resolves.toEqual({ sermons: [], total: 0 });
    expect(mockedApi.get).toHaveBeenCalledWith('/spiritual/sermons', {
      params: { limit: 40 },
    });
  });

  it('requests an explicit sermon page and rejects a missing page total', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { sermons: [] } } as never);

    await expect(spiritualService.getSermons('church-1', { page: 2, limit: 25 }))
      .rejects.toThrow('invalid sermon total');
  });

  it('normalizes shared devotional and sermon arrays', async () => {
    mockedApi.get
      .mockResolvedValueOnce({ data: [{
        id: 'devotional-1', churchId: 'church-1', title: 'Grace', scripture: 'Ephesians 2:8', scriptureText: 'Saved by grace.',
        content: 'Reflect.', author: 'Pastor Ama', date: '2026-08-01T00:00:00Z',
      }] } as never)
      .mockResolvedValueOnce({ data: [{
        id: 'sermon-1', churchId: 'church-1', title: 'Grace', speaker: 'Pastor Ama', date: '2026-08-01T00:00:00Z',
        duration: '42:00', description: 'A message about grace.',
      }] } as never);

    await expect(spiritualService.getDevotionals('church-1')).resolves.toMatchObject({
      devotionals: [{ scripture: 'Saved by grace.', scriptureReference: 'Ephesians 2:8' }], total: 1,
    });
    await expect(spiritualService.getSermons('church-1')).resolves.toMatchObject({ sermons: [{ id: 'sermon-1' }], total: 1 });
  });

  it('rejects an unsafe prayer id before recording support', async () => {
    await expect(spiritualService.prayForRequest('prayer/unsafe id'))
      .rejects.toThrow('requested prayer is invalid');
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it('tolerates a count-less prayer action response', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: undefined } as never);
    await expect(spiritualService.prayForRequest('prayer-1')).resolves.toEqual({});
  });

  it('posts the privacy choice with the prayer request', async () => {
    const request = {
      title: 'Family',
      description: 'Please pray with us.',
      isAnonymous: true,
    };
    mockedApi.post.mockResolvedValueOnce({ data: { success: true, data: {
      id: 'prayer-1', churchId: 'church-1', memberId: 'member-1', prayerCount: 0,
      createdAt: '2026-08-01T00:00:00Z', ...request,
    } } } as never);

    await spiritualService.createPrayerRequest({ ...request, title: ' Family ' }, 'church-1', 'member-1');
    expect(mockedApi.post).toHaveBeenCalledWith('/spiritual/prayer-requests', request);
  });

  it('removes anonymous ownership and author labels from public list state', () => {
    expect(normalizePrayerRequest({
      id: 'prayer-1', churchId: 'church-1', memberId: 'member-1', title: 'Family',
      description: 'Please pray', isAnonymous: true, prayerCount: 0,
      authorName: 'Ama Mensah', createdAt: '2026-08-01T00:00:00Z',
    }, 'church-1')).not.toMatchObject({ memberId: expect.anything(), authorName: expect.anything() });
  });

  it('accepts a privacy-minimized public prayer without a member identifier', () => {
    expect(normalizePrayerRequest({
      id: 'prayer-1', churchId: 'church-1', title: 'Family', description: 'Please pray',
      isAnonymous: true, prayerCount: 0, createdAt: '2026-08-01T00:00:00Z',
    }, 'church-1')).toEqual({
      id: 'prayer-1', churchId: 'church-1', title: 'Family', description: 'Please pray',
      isAnonymous: true, prayerCount: 0, createdAt: '2026-08-01T00:00:00Z',
    });
  });

  it('still requires private ownership on a created prayer acknowledgement', () => {
    expect(() => normalizePrayerRequest({
      id: 'prayer-1', churchId: 'church-1', title: 'Family', description: 'Please pray',
      isAnonymous: true, prayerCount: 0, createdAt: '2026-08-01T00:00:00Z',
    }, 'church-1', 'member-1')).toThrow('invalid prayer request');
  });

  it.each([
    { title: 'Changed title' },
    { description: 'Changed description' },
    { isAnonymous: false },
  ])('rejects a created prayer that changes member intent: %p', async (override) => {
    mockedApi.post.mockResolvedValueOnce({ data: {
      id: 'prayer-1', churchId: 'church-1', memberId: 'member-1', title: 'Family',
      description: 'Please pray', isAnonymous: true, prayerCount: 0,
      createdAt: '2026-08-01T00:00:00Z', ...override,
    } } as never);
    await expect(spiritualService.createPrayerRequest({
      title: 'Family', description: 'Please pray', isAnonymous: true,
    }, 'church-1', 'member-1')).rejects.toThrow('invalid prayer request');
  });

  it('rejects cross-church devotional and sermon content', () => {
    expect(() => normalizeDevotional({
      id: 'dev-1', churchId: 'other', title: 'Grace', scripture: 'John 1:1',
      scriptureText: 'In the beginning', content: 'Reflect', author: 'Pastor', date: '2026-08-01',
    }, 'church-1')).toThrow('invalid devotional');
    expect(() => normalizeSermon({
      id: 'sermon-1', churchId: 'other', title: 'Grace', speaker: 'Pastor',
      date: '2026-08-01', duration: '42:00', description: 'Message',
    }, 'church-1')).toThrow('invalid sermon');
  });

  it.each([-1, 1.5, Number.NaN])('rejects an unsafe prayer count %s', async (prayerCount) => {
    mockedApi.post.mockResolvedValueOnce({ data: { prayerCount } } as never);
    await expect(spiritualService.prayForRequest('prayer-1')).rejects.toThrow('invalid prayer count');
  });

  it('rejects a prayer acknowledgement for another request', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { requestId: 'prayer-2', prayerCount: 4 } } as never);
    await expect(spiritualService.prayForRequest('prayer-1')).rejects.toThrow('invalid prayer count');
  });

  it('rejects a created prayer owned by another member', () => {
    expect(() => normalizePrayerRequest({
      id: 'prayer-1', churchId: 'church-1', memberId: 'member-2', title: 'Family',
      description: 'Please pray', isAnonymous: true, prayerCount: 0,
      createdAt: '2026-08-01T00:00:00Z',
    }, 'church-1', 'member-1')).toThrow('invalid prayer request');
  });

  it('rejects a missing collection instead of reporting false emptiness', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { total: 0 } } as never);
    await expect(spiritualService.getSermons('church-1')).rejects.toThrow('invalid sermons');
  });

  it.each([
    ['identifier', { id: 'prayer-1\u0000suffix', churchId: 'church-1', memberId: 'member-1', title: 'Family', description: 'Please pray', isAnonymous: true, createdAt: '2026-08-01' }],
    ['title', { id: 'prayer-1', churchId: 'church-1', memberId: 'member-1', title: 'x'.repeat(201), description: 'Please pray', isAnonymous: true, createdAt: '2026-08-01' }],
    ['description', { id: 'prayer-1', churchId: 'church-1', memberId: 'member-1', title: 'Family', description: 'x'.repeat(2_001), isAnonymous: true, createdAt: '2026-08-01' }],
  ])('rejects a prayer request with an unsafe or oversized %s', (_field, request) => {
    expect(() => normalizePrayerRequest(request, 'church-1')).toThrow('invalid prayer request');
  });

  it('preserves bounded multiline prayer detail', () => {
    expect(normalizePrayerRequest({
      id: 'prayer-1', churchId: 'church-1', memberId: 'member-1', title: 'Family',
      description: 'Please pray for healing\nand peace', isAnonymous: true, createdAt: '2026-08-01',
    }, 'church-1').description).toContain('\n');
  });

  it('rejects malformed pagination before transport', async () => {
    await expect(spiritualService.getPrayerRequests('church-1', { page: 0, limit: 101 }))
      .rejects.toThrow('spiritual page');
    expect(mockedApi.get).not.toHaveBeenCalled();
  });

  it('rejects a response beyond the requested spiritual page size', async () => {
    const prayer = (id: string) => ({
      id, churchId: 'church-1', memberId: 'member-1', title: 'Family',
      description: 'Please pray', isAnonymous: true, createdAt: '2026-08-01',
    });
    mockedApi.get.mockResolvedValueOnce({ data: { data: [prayer('prayer-1'), prayer('prayer-2')], total: 2 } } as never);
    await expect(spiritualService.getPrayerRequests('church-1', { limit: 1 }))
      .rejects.toThrow('too many prayer requests');
  });

  it('rejects oversized prayer creation and reaction IDs before transport', async () => {
    await expect(spiritualService.createPrayerRequest({
      title: 'Family', description: 'x'.repeat(2_001), isAnonymous: true,
    }, 'church-1', 'member-1')).rejects.toThrow('prayer request is invalid');
    await expect(spiritualService.prayForRequest('x'.repeat(129))).rejects.toThrow('requested prayer is invalid');
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it.each([
    () => spiritualService.getTodayDevotional('church/unsafe'),
    () => spiritualService.getPrayerRequests('church/unsafe'),
    () => spiritualService.getSermon('sermon/unsafe', 'church-1'),
    () => spiritualService.createPrayerRequest({
      title: 'Family', description: 'Please pray', isAnonymous: true,
    }, 'church-1', 'member/unsafe'),
  ])('rejects an unsafe spiritual route identity before transport', async (request) => {
    await expect(request()).rejects.toThrow();
    expect(mockedApi.get).not.toHaveBeenCalled();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });
});

describe('spiritual media boundary', () => {
  it.each([
    'http://cdn.example/sermon.mp3',
    'javascript:alert(1)',
    'altaros://sermons',
    'https://user:secret@cdn.example/sermon.mp3',
    '/sermon.mp3',
    '',
  ])('rejects unsafe media URL %s', (value) => {
    expect(safeSpiritualMediaUrl(value)).toBeNull();
  });

  it('accepts an absolute credential-free HTTPS media URL', () => {
    expect(safeSpiritualMediaUrl(' https://cdn.example/sermon.mp3 '))
      .toBe('https://cdn.example/sermon.mp3');
  });

  it('rejects an oversized media URL before parsing or playback', () => {
    expect(safeSpiritualMediaUrl(`https://cdn.example/${'x'.repeat(2_100)}`)).toBeNull();
  });

  it('prefers audio with an accurate accessible playback label', () => {
    expect(sermonPlaybackAction({
      id: 'sermon-1', title: 'Grace', audioUrl: 'https://cdn.example/grace.mp3',
      videoUrl: 'https://video.example/grace',
    }, false, null)).toMatchObject({
      url: 'https://cdn.example/grace.mp3', kind: 'audio', disabled: false,
      busy: false, label: 'Listen to Grace',
    });
  });

  it('uses video when audio is absent and closes playback while offline', () => {
    expect(sermonPlaybackAction({
      id: 'sermon-1', title: 'Grace', videoUrl: 'https://video.example/grace',
    }, true, null)).toMatchObject({
      kind: 'video', disabled: true, label: 'Watch Grace',
      hint: 'Reconnect to open this sermon.',
    });
  });

  it('single-flights playback and distinguishes the busy row', () => {
    const sermon = { id: 'sermon-1', title: 'Grace', audioUrl: 'https://cdn.example/grace.mp3' };
    expect(sermonPlaybackAction(sermon, false, 'sermon-1')).toMatchObject({
      disabled: true, busy: true, hint: 'Opening this sermon on your device.',
    });
    expect(sermonPlaybackAction({ ...sermon, id: 'sermon-2' }, false, 'sermon-1')).toMatchObject({
      disabled: true, busy: false, hint: 'Wait for the current sermon to open.',
    });
  });
});
