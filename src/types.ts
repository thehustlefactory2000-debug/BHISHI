export interface Admin {
  id: string;
  email: string;
  password: string;
  createdAt: string;
  language: "en" | "mr" | "hi";
  theme: "light" | "dark" | "system";
}

export interface MemberContributor {
  id: string;
  name: string;
  phone: string;
}

export interface Member {
  id: string;
  name: string;
  phone: string;
  contributors: MemberContributor[];
  hasWon: boolean;
  payoutMonth?: number;
}

export interface ContributorPayment {
  contributorId: string;
  paid: boolean;
  paidDate?: string;
  paymentMode?: "online" | "offline";
  paidAmount?: number;
}

export interface Payment {
  memberId: string;
  paid: boolean;
  paidDate?: string;
  paymentMode?: "online" | "offline";
  paidAmount?: number;
  subPayments: ContributorPayment[];
}

export interface MonthRecord {
  monthNumber: number;
  expectedAmount: number;
  payments: Payment[];
  winnerId?: string;
  isLocked: boolean;
  lockedAt?: string;
}

export interface BhishiGroup {
  id: string;
  name: string;
  monthlyAmount: number;
  totalMembers: number;
  interestRate: number;
  startDate: string;
  payoutDate: number;
  members: Member[];
  months: MonthRecord[];
  createdAt: string;
  isCompleted: boolean;
}

export interface MemberDraft {
  id: string;
  name: string;
  phone: string;
  contributors: MemberContributor[];
}

export interface GroupDraft {
  name: string;
  monthlyAmount: number;
  totalMembers: number;
  interestRatePercent: number;
  startDate: string;
  payoutDate: number;
  members: MemberDraft[];
}

export interface Session {
  adminId: string;
  token: string;
}

export interface PaymentUpdateInput {
  paid: boolean;
  paidDate?: string;
  paymentMode?: "online" | "offline";
  paidAmount?: number;
}

export interface GroupUpdateInput {
  name: string;
  payoutDate: number;
  startDate: string;
  monthlyAmount?: number;
  totalMembers?: number;
  interestRatePercent?: number;
}

export interface RemoteContributorRow {
  id?: string | null;
  name: string;
  phone: string;
}

export interface RemoteContributorPaymentRow {
  contributor_id: string;
  paid: boolean;
  paid_date: string | null;
  payment_mode: "online" | "offline" | null;
  paid_amount: number | null;
}

export interface RemotePaymentRow {
  member_id: string;
  paid: boolean;
  paid_date: string | null;
  payment_mode: "online" | "offline" | null;
  paid_amount: number | null;
  sub_payments: RemoteContributorPaymentRow[] | null;
}

export interface RemoteMonthRow {
  month_number: number;
  expected_amount: number;
  winner_member_id: string | null;
  is_locked: boolean;
  locked_at: string | null;
  bhishi_payments: RemotePaymentRow[];
}

export interface RemoteMemberRow {
  id: string;
  name: string;
  phone: string;
  contributors: RemoteContributorRow[] | null;
  has_won: boolean;
  payout_month: number | null;
}

export interface RemoteGroupRow {
  id: string;
  name: string;
  monthly_amount: number;
  total_members: number;
  interest_rate: number;
  start_date: string;
  payout_date: number;
  created_at: string;
  is_completed: boolean;
  bhishi_members: RemoteMemberRow[];
  bhishi_months: RemoteMonthRow[];
}

export interface RemoteAdminProfile {
  id: string;
  email: string;
  preferred_language: Admin["language"];
  preferred_theme: Admin["theme"];
  created_at: string;
  updated_at: string;
}
