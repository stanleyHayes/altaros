export enum MemberStatus {
  ACTIVE = "ACTIVE",
  INACTIVE = "INACTIVE",
  VISITOR = "VISITOR",
  TRANSFERRED = "TRANSFERRED",
}

export interface Member {
  id: string;
  churchId: string;
  userId?: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  dateOfBirth?: Date;
  gender?: string;
  address?: string;
  familyId?: string;
  departmentIds: string[];
  status: MemberStatus;
  joinDate: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Family {
  id: string;
  churchId: string;
  name: string;
  memberIds: string[];
}
