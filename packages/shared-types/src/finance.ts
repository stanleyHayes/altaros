export enum TransactionType {
  TITHE = "TITHE",
  OFFERING = "OFFERING",
  DONATION = "DONATION",
  EXPENSE = "EXPENSE",
}

export enum PaymentMethod {
  MOBILE_MONEY = "MOBILE_MONEY",
  CARD = "CARD",
  CRYPTO = "CRYPTO",
  BANK_TRANSFER = "BANK_TRANSFER",
  CASH = "CASH",
}

export enum PaymentStatus {
  PENDING = "PENDING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  REFUNDED = "REFUNDED",
}

export enum ExpenseCategory {
  UTILITIES = "UTILITIES",
  SALARIES = "SALARIES",
  MAINTENANCE = "MAINTENANCE",
  MISSIONS = "MISSIONS",
  EVENTS = "EVENTS",
  SUPPLIES = "SUPPLIES",
  OTHER = "OTHER",
}

export interface ExpenseSummaryItem {
  category: string;
  total: number;
}

export interface Transaction {
  id: string;
  churchId: string;
  memberId?: string;
  type: TransactionType;
  amount: number;
  currency: string;
  paymentMethod: PaymentMethod;
  status: PaymentStatus;
  reference: string;
  description?: string;
  category?: ExpenseCategory;
  campaignId?: string;
  createdAt: Date;
}

export interface Campaign {
  id: string;
  churchId: string;
  title: string;
  description?: string;
  targetAmount: number;
  currentAmount: number;
  startDate: Date;
  endDate: Date;
  isActive: boolean;
}
