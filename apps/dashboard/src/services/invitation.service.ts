import { del, get, post } from './api';

export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export interface Invitation {
  id: string;
  churchId: string;
  email?: string;
  phone?: string;
  name?: string;
  roleId: string;
  roleName?: string;
  status: InvitationStatus;
  invitedBy?: string;
  invitedAt: string;
  expiresAt: string;
  acceptedAt?: string;
  message?: string;
  /** Computed by the server: pending but past its expiry. */
  expired: boolean;
}

export interface InvitePayload {
  email?: string;
  phone?: string;
  name?: string;
  roleId: string;
  message?: string;
}

export interface InviteResult {
  invitation: Invitation;
  /**
   * The acceptance link, returned once to the admin who issued it.
   *
   * Shown in the UI deliberately. It is the answer when delivery failed, and
   * the answer for a church whose email is not configured yet — the secretary
   * copies it into WhatsApp. It is the only place the raw token exists outside
   * the message that was sent.
   */
  link: string;
  /** Which channel delivered it, or empty when nothing did. */
  delivered: string;
  /** Present when delivery failed. The invitation still exists. */
  deliveryError?: string;
}

export async function listInvitations(status?: InvitationStatus): Promise<Invitation[]> {
  return get<Invitation[]>('/invitations', { params: status ? { status } : undefined });
}

export async function invite(payload: InvitePayload): Promise<InviteResult> {
  return post<InviteResult>('/invitations', payload);
}

/** Issues a new token and invalidates the previous link. */
export async function resendInvitation(id: string): Promise<InviteResult> {
  return post<InviteResult>(`/invitations/${id}/resend`);
}

export async function revokeInvitation(id: string): Promise<void> {
  await del(`/invitations/${id}`);
}

export interface CreateUserPayload {
  email?: string;
  phone?: string;
  name: string;
  roleId: string;
  password: string;
}

/**
 * Adds someone directly, with a password the admin sets.
 *
 * For the case invitations cannot serve: someone with no email address and a
 * phone that receives SMS unreliably, entered at the desk. The account is
 * flagged to require a password change at first sign-in, because the admin
 * knows a working credential for it.
 */
export async function createUser(payload: CreateUserPayload): Promise<{ note: string }> {
  return post<{ note: string }>('/users', payload);
}
