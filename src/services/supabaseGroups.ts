import { supabase } from "../lib/supabase";
import { BhishiGroup, GroupDraft, RemoteGroupRow, RemoteMemberRow, RemotePaymentRow } from "../types";
import { createContributorSubPayments } from "../utils/helpers";
import { formatSupabaseError } from "../utils/supabaseErrors";

const groupSelect = `
  id,
  name,
  monthly_amount,
  total_members,
  interest_rate,
  start_date,
  payout_date,
  created_at,
  is_completed,
  bhishi_members (
    id,
    name,
    phone,
    contributors,
    has_won,
    payout_month
  ),
  bhishi_months (
    id,
    month_number,
    expected_amount,
    winner_member_id,
    is_locked,
    locked_at,
    bhishi_payments (
      member_id,
      paid,
      paid_date,
      payment_mode,
      paid_amount,
      sub_payments
    )
  )
`;

const normalizeRemoteMember = (member: RemoteMemberRow) => {
  const contributors = Array.isArray(member.contributors) && member.contributors.length > 0
    ? member.contributors.map((contributor, index) => ({
        id: contributor.id ?? `${member.id}-contributor-${index + 1}`,
        name: contributor.name,
        phone: contributor.phone
      }))
    : [{ id: `${member.id}-primary`, name: member.name, phone: member.phone }];

  return {
    id: member.id,
    name: member.name,
    phone: contributors[0]?.phone ?? member.phone,
    contributors,
    hasWon: member.has_won,
    payoutMonth: member.payout_month ?? undefined
  };
};

const normalizeRemotePayment = (payment: RemotePaymentRow, expectedAmount: number, contributors: { id: string }[]) => {
  const subPayments = Array.isArray(payment.sub_payments) && payment.sub_payments.length > 0
    ? payment.sub_payments.map((subPayment) => ({
        contributorId: subPayment.contributor_id,
        paid: subPayment.paid,
        paidDate: subPayment.paid_date ?? undefined,
        paymentMode: subPayment.payment_mode ?? undefined,
        paidAmount: subPayment.paid_amount ?? undefined
      }))
    : createContributorSubPayments(expectedAmount, contributors.map((contributor) => ({ ...contributor, name: "", phone: "" })));

  const collected = subPayments.reduce((sum, subPayment) => sum + (subPayment.paid ? subPayment.paidAmount ?? 0 : 0), 0);

  return {
    memberId: payment.member_id,
    paid: subPayments.every((subPayment) => subPayment.paid),
    paidDate: payment.paid_date ?? undefined,
    paymentMode: payment.payment_mode ?? undefined,
    paidAmount: collected,
    subPayments
  };
};

export function mapRemoteGroup(row: RemoteGroupRow): BhishiGroup {
  const members = [...(row.bhishi_members ?? [])]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(normalizeRemoteMember);

  return {
    id: row.id,
    name: row.name,
    monthlyAmount: Number(row.monthly_amount),
    totalMembers: row.total_members,
    interestRate: Number(row.interest_rate),
    startDate: row.start_date,
    payoutDate: row.payout_date,
    createdAt: row.created_at,
    isCompleted: row.is_completed,
    members,
    months: [...(row.bhishi_months ?? [])]
      .sort((a, b) => a.month_number - b.month_number)
      .map((month) => ({
        monthNumber: month.month_number,
        expectedAmount: Number(month.expected_amount),
        winnerId: month.winner_member_id ?? undefined,
        isLocked: false,
        lockedAt: undefined,
        payments: [...(month.bhishi_payments ?? [])].map((payment) => {
          const member = members.find((entry) => entry.id === payment.member_id);
          return normalizeRemotePayment(payment, Number(month.expected_amount), member?.contributors ?? []);
        })
      }))
  };
}

export async function fetchGroupSnapshots() {
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase
    .from("bhishi_groups")
    .select(groupSelect)
    .order("created_at", { ascending: false });

  if (error) throw new Error(formatSupabaseError(error, "Failed to load groups from Supabase."));
  return (data ?? []) as RemoteGroupRow[];
}

export async function createRemoteGroup(draft: GroupDraft) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const payload = {
    p_name: draft.name.trim(),
    p_monthly_amount: draft.monthlyAmount,
    p_total_members: draft.totalMembers,
    p_interest_rate: draft.interestRatePercent / 100,
    p_start_date: draft.startDate,
    p_payout_date: draft.payoutDate,
    p_members: draft.members.map((member, index) => ({
      member_number: index + 1,
      name: member.name.trim(),
      phone: member.phone.trim(),
      contributors: member.contributors.map((contributor) => ({
        id: contributor.id,
        name: contributor.name.trim(),
        phone: contributor.phone.trim()
      }))
    }))
  };

  const { data, error } = await supabase.rpc("create_bhishi_group", payload);
  if (error) throw new Error(formatSupabaseError(error, "Failed to create the group in Supabase."));
  return data as string;
}

export async function fetchGroupSnapshotById(groupId: string) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase
    .from("bhishi_groups")
    .select(groupSelect)
    .eq("id", groupId)
    .single();

  if (error) throw new Error(formatSupabaseError(error, "Failed to load the group from Supabase."));
  return data as RemoteGroupRow;
}

export async function updateRemoteGroup(
  groupId: string,
  input: { name?: string; monthlyAmount?: number; payoutDate?: number; startDate?: string; interestRatePercent?: number }
) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const { error } = await supabase.rpc("update_bhishi_group", {
    p_group_id: groupId,
    p_name: input.name?.trim() ?? null,
    p_monthly_amount: input.monthlyAmount ?? null,
    p_interest_rate: input.interestRatePercent !== undefined ? input.interestRatePercent / 100 : null,
    p_start_date: input.startDate ?? null,
    p_payout_date: input.payoutDate ?? null
  });

  if (error) throw new Error(formatSupabaseError(error, "Failed to update the group in Supabase."));
  return fetchGroupSnapshotById(groupId);
}

export async function deleteRemoteGroup(groupId: string) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const { error } = await supabase.from("bhishi_groups").delete().eq("id", groupId);
  if (error) throw new Error(formatSupabaseError(error, "Failed to delete the group from Supabase."));
}

export async function recordRemotePayment(
  groupId: string,
  monthNumber: number,
  memberId: string,
  contributorId: string,
  input: {
    paid: boolean;
    paidDate?: string;
    paymentMode?: "online" | "offline";
    paidAmount?: number;
  }
) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("record_bhishi_payment", {
    p_group_id: groupId,
    p_month_number: monthNumber,
    p_member_id: memberId,
    p_contributor_id: contributorId,
    p_paid: input.paid,
    p_paid_date: input.paidDate,
    p_payment_mode: input.paymentMode,
    p_paid_amount: input.paidAmount
  });

  if (error) throw new Error(formatSupabaseError(error, "Failed to update the payment in Supabase."));
  return data;
}

export async function markAllRemotePaymentsPaid(
  groupId: string,
  monthNumber: number,
  input: { paymentMode?: "online" | "offline"; paidDate?: string } = {}
) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("mark_bhishi_month_paid_for_all", {
    p_group_id: groupId,
    p_month_number: monthNumber,
    p_payment_mode: input.paymentMode ?? "online",
    p_paid_date: input.paidDate
  });

  if (error) throw new Error(formatSupabaseError(error, "Failed to mark the month as paid in Supabase."));
  return data;
}

export async function selectRemoteWinner(groupId: string, monthNumber: number, memberId: string) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("select_bhishi_winner", {
    p_group_id: groupId,
    p_month_number: monthNumber,
    p_member_id: memberId
  });

  if (error) throw new Error(formatSupabaseError(error, "Failed to select the winner in Supabase."));
  return data as number;
}

export function subscribeToAdminRealtime(adminId: string, onChange: () => void) {
  if (!supabase) return () => undefined;

  const client = supabase;
  let hasLoggedRealtimeFailure = false;
  const logRealtimeFallback = () => {
    if (hasLoggedRealtimeFailure) return;
    hasLoggedRealtimeFailure = true;
    console.warn("Supabase realtime is unavailable. Falling back to dashboard polling.");
  };

  const channel = client
    .channel(`bhishi-admin-${adminId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "bhishi_groups", filter: `admin_id=eq.${adminId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "bhishi_members", filter: `admin_id=eq.${adminId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "bhishi_months", filter: `admin_id=eq.${adminId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "bhishi_payments", filter: `admin_id=eq.${adminId}` }, onChange)
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        logRealtimeFallback();
      }
    });

  return () => {
    void client.removeChannel(channel);
  };
}
