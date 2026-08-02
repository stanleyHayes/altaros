import api from './api';
import welfareService, { normalizeEmergencyAcknowledgement, normalizeWelfareRequest, type CreateWelfareRequest } from './welfare.service';

jest.mock('./api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

const mockedApi = api as jest.Mocked<typeof api>;

describe('welfare service contract', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uses the member-owned history route from the shared Phase 2 contract', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { success: true, data: [] } } as never);
    await expect(welfareService.listMine('church-1', 'member-1')).resolves.toEqual([]);
    expect(mockedApi.get).toHaveBeenCalledWith('/welfare/my-requests');
  });

  it('preserves category, urgency, description, and anonymity on submission', async () => {
    const payload: CreateWelfareRequest = {
      category: 'housing',
      description: '  Temporary accommodation support  ',
      urgency: 'high',
      isAnonymous: true,
    };
    mockedApi.post.mockResolvedValueOnce({ data: { success: true, data: {
      id: 'case-1', churchId: 'church-1', memberId: 'member-1', ...payload,
      description: 'Temporary accommodation support',
      status: 'pending', createdAt: '2026-08-01',
    } } } as never);
    await welfareService.create(payload, 'church-1', 'member-1');
    expect(mockedApi.post).toHaveBeenCalledWith('/welfare/requests', {
      category: 'housing',
      description: 'Temporary accommodation support',
      urgency: 'high',
      isAnonymous: true,
    });
  });

  it.each([
    ['category', { category: 'medical' }],
    ['description', { description: 'Server changed the private context' }],
    ['urgency', { urgency: 'low' }],
    ['anonymity', { isAnonymous: false }],
    ['initial status', { status: 'approved' }],
  ])('rejects a created case with changed %s', async (_label, changed) => {
    const payload: CreateWelfareRequest = {
      category: 'housing', description: 'Temporary accommodation support', urgency: 'high', isAnonymous: true,
    };
    mockedApi.post.mockResolvedValueOnce({ data: { success: true, data: {
      id: 'case-1', churchId: 'church-1', memberId: 'member-1', ...payload, ...changed,
      status: 'status' in changed ? changed.status : 'pending', createdAt: '2026-08-01',
    } } } as never);
    await expect(welfareService.create(payload, 'church-1', 'member-1'))
      .rejects.toThrow(/invalid welfare request|did not match your submission/);
  });

  it('rebuilds the create body from the allowlisted private request fields', async () => {
    const payload = {
      category: 'food', description: ' Grocery support ', urgency: 'medium', isAnonymous: false,
      memberId: 'other-member', status: 'approved', internalNote: 'injected',
    } as CreateWelfareRequest & Record<string, unknown>;
    mockedApi.post.mockResolvedValueOnce({ data: { success: true, data: {
      id: 'case-1', churchId: 'church-1', memberId: 'member-1', category: 'food',
      description: 'Grocery support', urgency: 'medium', isAnonymous: false,
      status: 'pending', createdAt: '2026-08-01',
    } } } as never);
    await welfareService.create(payload, 'church-1', 'member-1');
    expect(mockedApi.post).toHaveBeenCalledWith('/welfare/requests', {
      category: 'food', description: 'Grocery support', urgency: 'medium', isAnonymous: false,
    });
  });

  it.each([
    { id: 'case-1', churchId: 'other', memberId: 'member-1', category: 'housing', description: 'Help', urgency: 'high', isAnonymous: true, status: 'pending', createdAt: '2026-08-01' },
    { id: 'case-1', churchId: 'church-1', memberId: 'other', category: 'housing', description: 'Help', urgency: 'high', isAnonymous: true, status: 'pending', createdAt: '2026-08-01' },
    { id: 'case-1', churchId: 'church-1', memberId: 'member-1', category: 'invalid', description: 'Help', urgency: 'high', isAnonymous: true, status: 'pending', createdAt: '2026-08-01' },
    { id: 'case-1', churchId: 'church-1', memberId: 'member-1', category: 'housing', description: '', urgency: 'high', isAnonymous: true, status: 'pending', createdAt: '2026-08-01' },
    { id: 'case-1', churchId: 'church-1', memberId: 'member-1', category: 'housing', description: 'Help', urgency: 'urgent', isAnonymous: true, status: 'pending', createdAt: '2026-08-01' },
    { id: 'case-1', churchId: 'church-1', memberId: 'member-1', category: 'housing', description: 'Help', urgency: 'high', isAnonymous: true, status: 'closed', createdAt: '2026-08-01' },
    { id: 'case-1', churchId: 'church-1', memberId: 'member-1', category: 'housing', description: 'Help', urgency: 'high', isAnonymous: true, status: 'pending', createdAt: 'not-a-date' },
  ])('rejects malformed or cross-member welfare records', (request) => {
    expect(() => normalizeWelfareRequest(request, 'church-1', 'member-1'))
      .toThrow('invalid welfare request');
  });

  it('rejects malformed history instead of reporting no private requests', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { data: [] } } as never);
    await expect(welfareService.listMine('church-1', 'member-1'))
      .rejects.toThrow('invalid welfare history');
  });

  it('requires an explicit emergency acknowledgement', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { success: false } } as never);
    await expect(welfareService.emergency(' Help now ', 'church-1', 'member-1'))
      .rejects.toThrow('did not acknowledge');
    expect(mockedApi.post).toHaveBeenCalledWith('/welfare/emergency-alert', { message: 'Help now' });
  });

  it('sends emergency context and requires an active owned alert record', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { success: true, data: {
      id: 'alert-1', churchId: 'church-1', memberId: 'member-1', title: 'Urgent help',
      description: 'Please call me', isActive: true, createdAt: '2026-08-01T10:00:00Z',
    } } } as never);
    await expect(welfareService.emergency('Please call me', 'church-1', 'member-1'))
      .resolves.toMatchObject({ id: 'alert-1', isActive: true });
    expect(mockedApi.post).toHaveBeenCalledWith('/welfare/emergency-alert', { message: 'Please call me' });
  });

  it.each([
    { churchId: 'other-church' },
    { memberId: 'other-member' },
    { description: 'Changed context' },
    { isActive: false },
    { createdAt: 'not-a-date' },
    { latitude: 91, longitude: 0 },
    { latitude: 5.6 },
  ])('rejects a contradictory emergency acknowledgement: %p', (changed) => {
    expect(() => normalizeEmergencyAcknowledgement({ success: true, data: {
      id: 'alert-1', churchId: 'church-1', memberId: 'member-1', title: 'Urgent help',
      description: 'Please call me', isActive: true, createdAt: '2026-08-01T10:00:00Z',
      ...changed,
    } }, 'church-1', 'member-1', 'Please call me')).toThrow('did not acknowledge');
  });

  it.each([
    ['unsafe identifier', { id: 'case/unsafe', churchId: 'church-1', memberId: 'member-1', category: 'housing', description: 'Help', urgency: 'high', isAnonymous: true, status: 'pending', createdAt: '2026-08-01' }],
    ['oversized description', { id: 'case-1', churchId: 'church-1', memberId: 'member-1', category: 'housing', description: 'x'.repeat(2_001), urgency: 'high', isAnonymous: true, status: 'pending', createdAt: '2026-08-01' }],
    ['unsafe description', { id: 'case-1', churchId: 'church-1', memberId: 'member-1', category: 'housing', description: 'Help\u0000now', urgency: 'high', isAnonymous: true, status: 'pending', createdAt: '2026-08-01' }],
  ])('rejects a welfare record with an %s', (_label, request) => {
    expect(() => normalizeWelfareRequest(request, 'church-1', 'member-1'))
      .toThrow('invalid welfare request');
  });

  it('preserves line breaks in bounded private context', () => {
    expect(normalizeWelfareRequest({
      id: 'case-1', churchId: 'church-1', memberId: 'member-1', category: 'housing',
      description: 'Temporary housing needed\nTwo children are with me', urgency: 'high',
      isAnonymous: true, status: 'pending', createdAt: '2026-08-01',
    }, 'church-1', 'member-1').description).toContain('\n');
  });

  it('keeps internal case-management fields out of member-facing state', () => {
    const normalized = normalizeWelfareRequest({
      id: 'case-1', churchId: 'church-1', memberId: 'member-1', category: 'housing',
      description: 'Temporary housing needed', urgency: 'high', isAnonymous: true,
      status: 'under_review', createdAt: '2026-08-01', assignedPastorId: 'pastor-1',
      internalNotes: 'Sensitive staff-only assessment', riskScore: 0.93,
    }, 'church-1', 'member-1');
    expect(normalized).toEqual({
      id: 'case-1', churchId: 'church-1', memberId: 'member-1', category: 'housing',
      description: 'Temporary housing needed', urgency: 'high', isAnonymous: true,
      status: 'under_review', createdAt: '2026-08-01',
    });
  });

  it('rejects unsafe expected tenant identities in direct normalization', () => {
    expect(() => normalizeWelfareRequest({
      id: 'case-1', churchId: 'church/unsafe', memberId: 'member-1', category: 'housing',
      description: 'Help', urgency: 'high', isAnonymous: true, status: 'pending',
      createdAt: '2026-08-01',
    }, 'church/unsafe', 'member-1')).toThrow('invalid welfare request');
  });

  it('rejects excessive private history before mapping it into the screen', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { success: true, data: Array.from({ length: 101 }, (_, index) => ({ id: `case-${index}` })) } } as never);
    await expect(welfareService.listMine('church-1', 'member-1'))
      .rejects.toThrow('too many welfare requests');
  });

  it('rejects oversized create and emergency context before transport', async () => {
    const oversized = 'x'.repeat(2_001);
    await expect(welfareService.create({
      category: 'medical', description: oversized, urgency: 'critical', isAnonymous: false,
    }, 'church-1', 'member-1')).rejects.toThrow('welfare request is invalid');
    await expect(welfareService.emergency(oversized, 'church-1', 'member-1'))
      .rejects.toThrow('emergency context is invalid');
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it.each([
    ['history church', () => welfareService.listMine('church/unsafe', 'member-1')],
    ['history member', () => welfareService.listMine('church-1', 'member unsafe')],
    ['create church', () => welfareService.create({
      category: 'medical', description: 'Help', urgency: 'critical', isAnonymous: false,
    }, 'church/unsafe', 'member-1')],
    ['create member', () => welfareService.create({
      category: 'medical', description: 'Help', urgency: 'critical', isAnonymous: false,
    }, 'church-1', 'member unsafe')],
    ['emergency church', () => welfareService.emergency('Help', 'church/unsafe', 'member-1')],
    ['emergency member', () => welfareService.emergency('Help', 'church-1', 'member unsafe')],
  ])('rejects an unsafe %s identity before transport', async (_label, action) => {
    await expect(action()).rejects.toThrow('member identity is invalid');
    expect(mockedApi.get).not.toHaveBeenCalled();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });
});
