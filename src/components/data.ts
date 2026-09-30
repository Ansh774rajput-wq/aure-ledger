import { businessDate } from "../domain/finance";
export type Snapshot = {
  available: string;
  lent: string;
  borrowed: string;
  interestEarned: string;
  lenderInterestPaid?: string;
  people: {
    id: string;
    name: string;
    phone: string | null;
    borrowerId: string | null;
    lenderId: string | null;
  }[];
  loans: {
    id: string;
    name: string;
    principal: string;
    rate: string;
    method: string;
    interest: string;
    start: string;
    due: string;
    status: string;
    remainingPrincipal: string;
    remainingInterest: string;
    payments: {
      id: string;
      amount: string;
      fees: string;
      interest: string;
      principal: string;
      date: string;
      reference: string | null;
      reversed?: boolean;
      reversalDate?: string | null;
      reversalReason?: string | null;
      canReverse?: boolean;
      unsupportedReason?: string;
    }[];
    adjustments: {
      id: string;
      amount: string;
      reason: string;
      createdAt: string;
      performedBy: string;
    }[];
  }[];
  borrowings: {
    id: string;
    name: string;
    principal: string;
    rate: string;
    method: string;
    interest: string;
    start: string;
    due: string;
    status: string;
    remainingPrincipal: string;
    remainingInterest: string;
    payments: {
      id: string;
      amount: string;
      fees: string;
      interest: string;
      principal: string;
      date: string;
      reference: string | null;
      reversed?: boolean;
      reversalDate?: string | null;
      reversalReason?: string | null;
      canReverse?: boolean;
      unsupportedReason?: string;
    }[];
    adjustments: {
      id: string;
      amount: string;
      reason: string;
      createdAt: string;
      performedBy: string;
    }[];
  }[];
  activity: {
    id: string;
    type: string;
    direction: string;
    amount: string;
    date: string;
    reference: string | null;
    entityId: string | null;
  }[];
};
export const empty: Snapshot = {
  available: "0",
  lent: "0",
  borrowed: "0",
  interestEarned: "0",
  people: [],
  loans: [],
  borrowings: [],
  activity: [],
};
export function sample(): Snapshot {
  const today = new Date(businessDate() + "T00:00:00Z");
  const day = (n: number) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  return {
    available: "75000",
    lent: "125000",
    borrowed: "0",
    interestEarned: "0",
    people: [
      {
        id: "p1",
        name: "Arjun Mehta",
        phone: null,
        borrowerId: "b1",
        lenderId: null,
      },
      {
        id: "p2",
        name: "Priya Sharma",
        phone: null,
        borrowerId: "b2",
        lenderId: null,
      },
      {
        id: "p3",
        name: "Rohan Das",
        phone: null,
        borrowerId: "b3",
        lenderId: null,
      },
    ],
    loans: [
      {
        id: "sample-01",
        name: "Arjun Mehta",
        principal: "50000",
        rate: "12",
        method: "ANNUAL_ACTUAL_365",
        interest: "1480",
        start: day(-85),
        due: day(5),
        status: "ACTIVE",
        remainingPrincipal: "50000",
        remainingInterest: "1480",
        payments: [],
        adjustments: [],
      },
      {
        id: "sample-02",
        name: "Priya Sharma",
        principal: "40000",
        rate: "12",
        method: "ANNUAL_ACTUAL_365",
        interest: "1184",
        start: day(-93),
        due: day(-3),
        status: "ACTIVE",
        remainingPrincipal: "40000",
        remainingInterest: "1184",
        payments: [],
        adjustments: [],
      },
      {
        id: "sample-03",
        name: "Rohan Das",
        principal: "35000",
        rate: "12",
        method: "ANNUAL_ACTUAL_365",
        interest: "1036",
        start: day(-76),
        due: day(14),
        status: "ACTIVE",
        remainingPrincipal: "35000",
        remainingInterest: "1036",
        payments: [],
        adjustments: [],
      },
    ],
    borrowings: [],
    activity: [
      {
        id: "t4",
        type: "LOAN_DISBURSEMENT_OUT",
        direction: "OUT",
        amount: "35000",
        date: day(-76),
        reference: "DEMO-004",
        entityId: "sample-03",
      },
      {
        id: "t3",
        type: "LOAN_DISBURSEMENT_OUT",
        direction: "OUT",
        amount: "50000",
        date: day(-85),
        reference: "DEMO-003",
        entityId: "sample-01",
      },
      {
        id: "t2",
        type: "LOAN_DISBURSEMENT_OUT",
        direction: "OUT",
        amount: "40000",
        date: day(-93),
        reference: "DEMO-002",
        entityId: "sample-02",
      },
      {
        id: "t1",
        type: "OWN_CAPITAL_IN",
        direction: "IN",
        amount: "200000",
        date: day(-100),
        reference: "DEMO-001",
        entityId: null,
      },
    ],
  };
}
export function formatIndianCurrency(val: string): string {
  if (!val) return "0";
  let str = val.trim();
  if (str.startsWith("₹")) str = str.slice(1).trim();
  const isNegative = str.startsWith("-") || str.startsWith("−");
  const cleaned = isNegative ? str.slice(1) : str.startsWith("+") ? str.slice(1) : str;
  const [intPart, fracPart] = cleaned.split(".");

  let formattedInt = intPart || "0";
  if (formattedInt.length > 3) {
    const lastThree = formattedInt.slice(-3);
    const rest = formattedInt.slice(0, -3);
    const groupedRest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    formattedInt = `${groupedRest},${lastThree}`;
  }

  const formatted = fracPart !== undefined ? `${formattedInt}.${fracPart}` : formattedInt;
  return isNegative ? `−${formatted}` : formatted;
}

export const rupees = (s: string) => {
  if (!s) return "₹0";
  let str = s.trim();
  if (str.startsWith("₹")) str = str.slice(1).trim();
  const isNegative = str.startsWith("-") || str.startsWith("−");
  const formatted = formatIndianCurrency(str);
  if (isNegative) {
    return "−₹" + formatted.replace(/^[−-]/, "");
  }
  return "₹" + formatted;
};

const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

export const dateLabel = (s: string) => {
  const d = new Date(s.includes("T") ? s : s + "T00:00:00Z");
  if (isNaN(d.getTime())) return s;
  return `${d.getUTCDate()} ${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

export const todayLabel = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now).split("-");
  const y = parts[0];
  const m = Number(parts[1]);
  const day = Number(parts[2]);
  return `${day} ${SHORT_MONTHS[m - 1]} ${y}`;
};

