export interface Event {
  id: string;
  churchId: string;
  title: string;
  description?: string;
  location?: string;
  startDate: Date;
  endDate: Date;
  isRecurring: boolean;
  recurrenceRule?: string;
  capacity?: number;
  rsvpCount: number;
  checkInCode?: string;
  createdAt: Date;
}

export type CheckInMethod = "QR" | "MANUAL";

export interface Attendance {
  id: string;
  eventId: string;
  memberId: string;
  churchId: string;
  checkedInAt: Date;
  method: CheckInMethod;
}

export type RsvpStatus = "GOING" | "MAYBE" | "NOT_GOING";

export interface RSVP {
  id: string;
  eventId: string;
  memberId: string;
  status: RsvpStatus;
}
