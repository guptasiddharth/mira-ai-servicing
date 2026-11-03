import type { RatePeriod } from "@/domain/finance/amortization";
import type { ISODate } from "@/lib/dates";

/** Records as they live inside the (simulated) enterprise systems of record. */

export interface Customer {
  id: string;
  name: string;
  firstName: string;
  phone: string;
  email: string;
  pan: string;
  city: string;
  segment: "Salaried" | "Self-employed";
  customerSince: ISODate;
  preferredLanguage: string;
  kycStatus: "verified" | "pending";
  loanIds: string[];
  cardIds: string[];
}

export interface Interaction {
  id: string;
  customerId: string;
  date: ISODate;
  channel: "call" | "email" | "app" | "branch" | "assistant";
  summary: string;
}

export interface LoanRecord {
  id: string;
  customerId: string;
  productName: string;
  principal: number;
  disbursedOn: ISODate;
  firstDueDate: ISODate;
  tenureMonths: number;
  rateType: "fixed" | "floating";
  ratePeriods: RatePeriod[];
  mandate: { type: "NACH"; bank: string; accountMasked: string };
  status: "active" | "closed";
  partPrepayments: { date: ISODate; amount: number; requestId: string }[];
}

export type PaymentStatus = "success" | "failed" | "pending";

export interface Payment {
  id: string;
  customerId: string;
  loanId: string;
  installmentNo: number;
  dueDate: ISODate;
  attemptDate: ISODate;
  amount: number;
  channel: "NACH" | "UPI" | "NetBanking";
  status: PaymentStatus;
  failure?: { code: string; reason: string; category: "customer" | "technical" };
  chargesLevied?: { type: "bounce"; amount: number; gst: number };
}

export type ServiceRequestType =
  | "PREPAYMENT"
  | "PAYMENT_DISPUTE"
  | "STATEMENT"
  | "GENERAL"
  | "CARD_DISPUTE"
  | "CARD_BLOCK";

export interface ServiceRequest {
  id: string;
  customerId: string;
  type: ServiceRequestType;
  status: "open" | "in_progress" | "resolved" | "closed";
  priority: "normal" | "high";
  createdAt: string;
  slaDueDate: ISODate;
  summary: string;
  details: Record<string, unknown>;
  channel: "assistant" | "call" | "app" | "branch";
}

export interface Card {
  id: string;
  customerId: string;
  variant: string;
  last4: string;
  creditLimit: number;
  availableLimit: number;
  outstanding: number;
  minimumDue: number;
  statementDate: ISODate;
  dueDate: ISODate;
  status: "active" | "blocked";
  rewardPoints: number;
}

export interface CardTransaction {
  id: string;
  cardId: string;
  customerId: string;
  date: ISODate;
  time: string;
  merchant: string;
  category: string;
  amount: number;
  status: "posted" | "disputed" | "reversed";
}

export interface EnterpriseDatabase {
  asOf: ISODate;
  customers: Customer[];
  interactions: Interaction[];
  loans: LoanRecord[];
  payments: Payment[];
  serviceRequests: ServiceRequest[];
  cards: Card[];
  cardTransactions: CardTransaction[];
}
