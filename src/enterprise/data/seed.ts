import { buildSchedule, type RatePeriod } from "@/domain/finance/amortization";
import { LOAN_POLICY } from "@/enterprise/data/policies";
import { addDays, addMonths, lastDayOfMonthOnOrBefore, today, type ISODate } from "@/lib/dates";
import type {
  Card,
  CardTransaction,
  Customer,
  EnterpriseDatabase,
  Interaction,
  LoanRecord,
  Payment,
} from "@/enterprise/types";

/**
 * Synthetic but internally consistent data. Dates are generated relative to
 * "today" so the demo always looks current; schedules and payments are derived
 * from the same amortization engine the assistant uses.
 */

interface LoanSeed {
  id: string;
  customerId: string;
  principal: number;
  tenureMonths: number;
  emiDay: number;
  emisPaid: number;
  rateType: "fixed" | "floating";
  /** Rate periods as offsets: installment index (1-based) at which the rate first applies. */
  rates: { fromInstallment: number; annualRate: number; reason: string }[];
  mandateBank: string;
  /** Installment numbers whose first NACH presentation failed. */
  failures: Record<number, { code: string; reason: string; category: "customer" | "technical"; retryAfterDays: number; retryChannel: Payment["channel"] }>;
}

const BOUNCE_GST = Math.round(LOAN_POLICY.bounceCharge * (LOAN_POLICY.gstPct / 100));

function buildLoan(seed: LoanSeed, asOf: ISODate): { loan: LoanRecord; payments: Payment[] } {
  const latestDue = lastDayOfMonthOnOrBefore(asOf, seed.emiDay);
  const firstDueDate = addMonths(latestDue, -(seed.emisPaid - 1), seed.emiDay);
  const disbursedOn = addMonths(firstDueDate, -1, Math.max(1, seed.emiDay - 3));

  const ratePeriods: RatePeriod[] = seed.rates.map((r) => ({
    // A reset becomes effective ~3 weeks before the installment it first affects.
    effectiveFrom: r.fromInstallment === 1 ? disbursedOn : addDays(addMonths(firstDueDate, r.fromInstallment - 1, seed.emiDay), -21),
    annualRate: r.annualRate,
    reason: r.reason,
  }));

  const loan: LoanRecord = {
    id: seed.id,
    customerId: seed.customerId,
    productName: "Personal Loan",
    principal: seed.principal,
    disbursedOn,
    firstDueDate,
    tenureMonths: seed.tenureMonths,
    rateType: seed.rateType,
    ratePeriods,
    mandate: { type: "NACH", bank: seed.mandateBank, accountMasked: "XXXXXX" + String(4000 + seed.principal / 1000).slice(-4) },
    status: "active",
    partPrepayments: [],
  };

  const schedule = buildSchedule({ principal: seed.principal, tenureMonths: seed.tenureMonths, firstDueDate, ratePeriods });
  const payments: Payment[] = [];
  for (const inst of schedule.slice(0, seed.emisPaid)) {
    const base = {
      customerId: seed.customerId,
      loanId: seed.id,
      installmentNo: inst.n,
      dueDate: inst.dueDate,
      amount: inst.emi,
    };
    const failure = seed.failures[inst.n];
    if (failure) {
      payments.push({
        ...base,
        id: `PMT-${seed.id.slice(-5)}-${String(inst.n).padStart(2, "0")}A`,
        attemptDate: inst.dueDate,
        channel: "NACH",
        status: "failed",
        failure: { code: failure.code, reason: failure.reason, category: failure.category },
        chargesLevied: { type: "bounce", amount: LOAN_POLICY.bounceCharge, gst: BOUNCE_GST },
      });
      payments.push({
        ...base,
        id: `PMT-${seed.id.slice(-5)}-${String(inst.n).padStart(2, "0")}B`,
        attemptDate: addDays(inst.dueDate, failure.retryAfterDays),
        channel: failure.retryChannel,
        status: "success",
      });
    } else {
      payments.push({
        ...base,
        id: `PMT-${seed.id.slice(-5)}-${String(inst.n).padStart(2, "0")}A`,
        attemptDate: inst.dueDate,
        channel: "NACH",
        status: "success",
      });
    }
  }
  return { loan, payments };
}

function cardTxns(cardId: string, customerId: string, asOf: ISODate, rows: [number, string, string, string, number][]): CardTransaction[] {
  return rows.map(([daysAgo, time, merchant, category, amount], i) => ({
    id: `TXN-${cardId.slice(-4)}-${String(i + 1).padStart(3, "0")}`,
    cardId,
    customerId,
    date: addDays(asOf, -daysAgo),
    time,
    merchant,
    category,
    amount,
    status: "posted",
  }));
}

export function createSeed(asOf: ISODate = today()): EnterpriseDatabase {
  const customers: Customer[] = [
    {
      id: "CUST-1001",
      name: "Priya Sharma",
      firstName: "Priya",
      phone: "+91 98201 45127",
      email: "priya.sharma@example.com",
      pan: "ABCPS4127K",
      city: "Mumbai",
      segment: "Salaried",
      customerSince: addMonths(asOf, -30),
      preferredLanguage: "English",
      kycStatus: "verified",
      loanIds: ["LN-PL-20481"],
      cardIds: [],
    },
    {
      id: "CUST-1002",
      name: "Rahul Verma",
      firstName: "Rahul",
      phone: "+91 99300 78214",
      email: "rahul.verma@example.com",
      pan: "BXRPV8214Q",
      city: "Pune",
      segment: "Self-employed",
      customerSince: addMonths(asOf, -44),
      preferredLanguage: "English",
      kycStatus: "verified",
      loanIds: ["LN-PL-17733"],
      cardIds: ["CC-4821"],
    },
    {
      id: "CUST-1003",
      name: "Ananya Iyer",
      firstName: "Ananya",
      phone: "+91 90040 31170",
      email: "ananya.iyer@example.com",
      pan: "CQAPI1170M",
      city: "Bengaluru",
      segment: "Salaried",
      customerSince: addMonths(asOf, -8),
      preferredLanguage: "English",
      kycStatus: "verified",
      loanIds: ["LN-PL-30912"],
      cardIds: ["CC-1170"],
    },
  ];

  const loanSeeds: LoanSeed[] = [
    {
      id: "LN-PL-20481",
      customerId: "CUST-1001",
      principal: 500_000,
      tenureMonths: 48,
      emiDay: 5,
      emisPaid: 14,
      rateType: "floating",
      rates: [
        { fromInstallment: 1, annualRate: 11.5, reason: "Sanctioned rate: KLR 9.00% + spread 2.50%" },
        { fromInstallment: 8, annualRate: 11.0, reason: "Quarterly reset: KLR revised from 9.00% to 8.50%" },
        { fromInstallment: 14, annualRate: 12.25, reason: "Quarterly reset: KLR revised from 8.50% to 9.75% after the policy repo rate increase" },
      ],
      mandateBank: "HDFC Bank",
      failures: {
        10: { code: "NACH-01", reason: "Balance insufficient", category: "customer", retryAfterDays: 3, retryChannel: "UPI" },
      },
    },
    {
      id: "LN-PL-17733",
      customerId: "CUST-1002",
      principal: 300_000,
      tenureMonths: 36,
      emiDay: 10,
      emisPaid: 20,
      rateType: "fixed",
      rates: [{ fromInstallment: 1, annualRate: 13.75, reason: "Fixed rate at sanction" }],
      mandateBank: "ICICI Bank",
      failures: {
        11: { code: "NACH-01", reason: "Balance insufficient", category: "customer", retryAfterDays: 5, retryChannel: "NetBanking" },
        17: { code: "NACH-01", reason: "Balance insufficient", category: "customer", retryAfterDays: 4, retryChannel: "UPI" },
        19: { code: "NACH-68", reason: "Mandate verification failed at destination bank (technical decline)", category: "technical", retryAfterDays: 2, retryChannel: "NACH" },
      },
    },
    {
      id: "LN-PL-30912",
      customerId: "CUST-1003",
      principal: 800_000,
      tenureMonths: 60,
      emiDay: 15,
      emisPaid: 4,
      rateType: "floating",
      rates: [{ fromInstallment: 1, annualRate: 10.99, reason: "Sanctioned rate: KLR 9.25% + spread 1.74%" }],
      mandateBank: "Axis Bank",
      failures: {},
    },
  ];

  const loans: LoanRecord[] = [];
  const payments: Payment[] = [];
  for (const s of loanSeeds) {
    const { loan, payments: p } = buildLoan(s, asOf);
    loans.push(loan);
    payments.push(...p);
  }

  const priyaLoan = loans[0];
  const priyaReset = priyaLoan.ratePeriods[2];
  const rahulLoan = loans[1];
  const interactions: Interaction[] = [
    { id: "INT-9001", customerId: "CUST-1001", date: priyaReset.effectiveFrom, channel: "email", summary: "Rate reset notice sent: KLR revised to 9.75%, revised EMI applicable from next instalment." },
    { id: "INT-9002", customerId: "CUST-1001", date: addMonths(asOf, -4), channel: "call", summary: "Customer asked about part-prepayment process. Advised to visit branch with cheque." },
    { id: "INT-9003", customerId: "CUST-1002", date: addDays(addMonths(rahulLoan.firstDueDate, 18), 3), channel: "call", summary: "Customer disputed bounce charge citing bank-side mandate error. Agent advised to email support; no ticket raised." },
    { id: "INT-9004", customerId: "CUST-1002", date: addDays(addMonths(rahulLoan.firstDueDate, 16), 6), channel: "call", summary: "Customer called about EMI bounce. Transferred twice between collections and payments teams." },
    { id: "INT-9005", customerId: "CUST-1003", date: addMonths(asOf, -1), channel: "app", summary: "Customer viewed foreclosure FAQ in app." },
  ];

  const cards: Card[] = [
    {
      id: "CC-4821",
      customerId: "CUST-1002",
      variant: "Kestrel Platinum",
      last4: "4821",
      creditLimit: 200_000,
      availableLimit: 151_386,
      outstanding: 48_614,
      minimumDue: 2_431,
      statementDate: addDays(asOf, -12),
      dueDate: addDays(asOf, 8),
      status: "active",
      rewardPoints: 12_480,
    },
    {
      id: "CC-1170",
      customerId: "CUST-1003",
      variant: "Kestrel Rewards",
      last4: "1170",
      creditLimit: 150_000,
      availableLimit: 128_955,
      outstanding: 21_045,
      minimumDue: 1_052,
      statementDate: addDays(asOf, -5),
      dueDate: addDays(asOf, 15),
      status: "active",
      rewardPoints: 3_210,
    },
  ];

  const cardTransactions: CardTransaction[] = [
    ...cardTxns("CC-4821", "CUST-1002", asOf, [
      [1, "20:14", "QuickBite Foods", "Dining", 1_249],
      [1, "20:14", "QuickBite Foods", "Dining", 1_249],
      [3, "11:02", "CityMart Superstore", "Groceries", 4_380],
      [6, "09:45", "Skyline Air", "Travel", 18_920],
      [9, "18:30", "Metro Fuel Station", "Fuel", 3_100],
      [14, "22:05", "StreamBox Subscription", "Entertainment", 649],
      [18, "13:12", "UrbanWear Online", "Shopping", 7_899],
      [26, "08:40", "Global Electronics", "Electronics", 11_168],
    ]),
    ...cardTxns("CC-1170", "CUST-1003", asOf, [
      [2, "19:20", "CityMart Superstore", "Groceries", 2_745],
      [5, "12:10", "BookNook", "Shopping", 1_350],
      [11, "21:45", "StreamBox Subscription", "Entertainment", 649],
      [16, "16:05", "Wellness Pharmacy", "Health", 1_980],
      [22, "10:30", "Skyline Air", "Travel", 14_321],
    ]),
  ];

  return { asOf, customers, interactions, loans, payments, serviceRequests: [], cards, cardTransactions };
}
