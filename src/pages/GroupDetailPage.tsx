import { FormEvent, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Circle, Download, FileText, Pencil, Trash2, Trophy } from "lucide-react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { useAppStore } from "../store/useAppStore";
import { GroupUpdateInput } from "../types";
import { formatCurrency, formatDate, formatDateInput, payoutDayLabel, todayIso } from "../utils/format";
import {
  exportGroupCsv,
  exportGroupPdf,
  getCollectedAmountForPayment,
  getGroupProgress,
  getMemberContributorNames,
  getMemberContributorPhones,
  getMemberExpectedTotal,
  getMemberPaidTotal,
  getPaidContributorCount,
  isPaymentFullyPaid,
  sumCollectedForGroup,
  sumCollectedForMonth,
  sumExpectedForGroup
} from "../utils/helpers";

export function GroupDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const groups = useAppStore((state) => state.groups);
  const updatePayment = useAppStore((state) => state.updatePayment);
  const markAllPaid = useAppStore((state) => state.markAllPaid);
  const selectWinner = useAppStore((state) => state.selectWinner);
  const deleteGroup = useAppStore((state) => state.deleteGroup);
  const updateGroup = useAppStore((state) => state.updateGroup);
  const group = groups.find((entry) => entry.id === id);
  const [tab, setTab] = useState<"months" | "members" | "summary">("months");
  const [selectedMonthIndex, setSelectedMonthIndex] = useState(0);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [winnerMonth, setWinnerMonth] = useState<number | null>(null);
  const [paymentDialog, setPaymentDialog] = useState<null | {
    title: string;
    subtitle?: string;
    paymentMode: "online" | "offline";
    paidDate: string;
    onConfirm: (details: { paymentMode: "online" | "offline"; paidDate: string }) => Promise<void>;
  }>(null);
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [pendingAction, setPendingAction] = useState<"delete" | null>(null);
  const [deletingGroupName, setDeletingGroupName] = useState("");
  const [groupDraft, setGroupDraft] = useState<GroupUpdateInput>({
    name: group?.name ?? "",
    payoutDate: group?.payoutDate ?? 1,
    startDate: formatDateInput(group?.startDate ?? ""),
    monthlyAmount: group?.monthlyAmount ?? 0,
    totalMembers: group?.totalMembers ?? 0,
    interestRatePercent: (group?.interestRate ?? 0) * 100
  });

  const winnerCandidates = useMemo(() => group?.members ?? [], [group]);

  const isValidPaidDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime()) && value <= todayIso();

  const openPaymentDialog = (config: {
    title: string;
    subtitle?: string;
    paymentMode?: "online" | "offline";
    paidDate?: string;
    onConfirm: (details: { paymentMode: "online" | "offline"; paidDate: string }) => Promise<void>;
  }) => {
    setPaymentDialog({
      title: config.title,
      subtitle: config.subtitle,
      paymentMode: config.paymentMode ?? "offline",
      paidDate: config.paidDate ?? todayIso(),
      onConfirm: config.onConfirm
    });
  };

  const closePaymentDialog = () => {
    if (paymentSubmitting) return;
    setPaymentDialog(null);
  };

  const confirmPaymentDialog = async () => {
    if (!paymentDialog) return;
    if (!paymentDialog.paymentMode || !paymentDialog.paidDate) return;
    if (!isValidPaidDate(paymentDialog.paidDate)) {
      setMessage("Paid date must be a valid date in YYYY-MM-DD format and cannot be in the future.");
      return;
    }

    setPaymentSubmitting(true);
    try {
      await paymentDialog.onConfirm({
        paymentMode: paymentDialog.paymentMode,
        paidDate: paymentDialog.paidDate
      });
      setPaymentDialog(null);
    } finally {
      setPaymentSubmitting(false);
    }
  };

  useEffect(() => {
    if (winnerMonth === null && paymentDialog === null) {
      delete document.body.dataset.modalOpen;
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (paymentDialog !== null) {
        if (!paymentSubmitting) setPaymentDialog(null);
        return;
      }
      setWinnerMonth(null);
    };

    document.body.dataset.modalOpen = "true";
    window.addEventListener("keydown", handleEscape);

    return () => {
      delete document.body.dataset.modalOpen;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [winnerMonth, paymentDialog, paymentSubmitting]);

  useEffect(() => {
    setSelectedMonthIndex(0);
  }, [group?.id]);

  useEffect(() => {
    if (!group) return;
    setSelectedMonthIndex((current) => Math.min(current, Math.max(group.months.length - 1, 0)));
  }, [group, group?.months.length]);

  if (!group) {
    if (pendingAction === "delete") {
      return (
        <AppShell title={deletingGroupName || "Deleting group"} subtitle="Removing group and syncing the latest dashboard state." backTo="/dashboard">
          <div className="card p-6 text-sm text-subtle">Deleting group...</div>
        </AppShell>
      );
    }

    return <Navigate to="/dashboard" replace />;
  }

  const progress = getGroupProgress(group);
  const totalExpected = sumExpectedForGroup(group);
  const totalCollected = sumCollectedForGroup(group);
  const canDelete = deleteConfirm === group.name;
  const totalContributors = group.members.reduce((sum, member) => sum + member.contributors.length, 0);
  const selectedMonth = group.months[selectedMonthIndex] ?? group.months[0];

  const submitGroupEdit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await updateGroup(group.id, groupDraft);
    setMessage(result.message);
    if (result.ok) setEditing(false);
  };

  const handleDeleteGroup = async () => {
    if (!canDelete || pendingAction === "delete") return;

    setDeletingGroupName(group.name);
    setPendingAction("delete");
    const result = await deleteGroup(group.id);
    setPendingAction(null);
    setMessage(result.message);

    if (result.ok) {
      navigate("/dashboard", { replace: true });
    }
  };

  const paymentDetailModal =
    paymentDialog !== null
      ? createPortal(
          <div className="fixed inset-0 z-[130] bg-slate-950/60 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="payment-detail-title">
            <button className="absolute inset-0 h-full w-full cursor-default" type="button" aria-label="Close payment dialog" onClick={closePaymentDialog} />
            <div className="relative flex min-h-full items-center justify-center p-4 sm:p-6">
              <div className="flex max-h-[min(78dvh,42rem)] w-full max-w-lg flex-col overflow-hidden rounded-[28px] border border-border bg-surface shadow-2xl sm:rounded-[32px]">
                <div className="border-b border-border bg-muted/40 px-4 py-4 sm:px-6">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.3em] text-subtle">Payment details</p>
                      <h2 id="payment-detail-title" className="mt-1.5 text-lg font-semibold sm:text-xl">{paymentDialog.title}</h2>
                    </div>
                    <button className="btn-secondary min-h-0 rounded-xl px-3 py-2 text-xs" type="button" onClick={closePaymentDialog} disabled={paymentSubmitting}>
                      Close
                    </button>
                  </div>
                  {paymentDialog.subtitle && <p className="mt-3 text-xs leading-relaxed text-subtle">{paymentDialog.subtitle}</p>}
                </div>
                <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 [-webkit-overflow-scrolling:touch] sm:px-6 sm:py-6">
                  <div className="space-y-5">
                    <div>
                      <label className="label">Payment mode</label>
                      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-muted/60 p-1.5">
                        {(["offline", "online"] as const).map((mode) => {
                          const active = paymentDialog.paymentMode === mode;
                          return (
                            <button
                              key={mode}
                              type="button"
                              className={`min-h-[48px] rounded-2xl px-4 py-3 text-sm font-medium transition ${active ? "bg-primary text-white shadow-lg shadow-orange-600/20" : "text-subtle hover:bg-surface hover:text-text"}`}
                              onClick={() => setPaymentDialog((current) => (current ? { ...current, paymentMode: mode } : current))}
                              aria-pressed={active}
                            >
                              {mode === "online" ? "Online" : "Offline"}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <label className="label" htmlFor="paid-date-input">Paid date</label>
                      <input
                        id="paid-date-input"
                        className="input min-h-[52px]"
                        type="date"
                        max={todayIso()}
                        value={paymentDialog.paidDate}
                        onChange={(event) => setPaymentDialog((current) => (current ? { ...current, paidDate: event.target.value } : current))}
                      />
                    </div>
                  </div>
                </div>
                <div className="border-t border-border bg-surface px-4 py-4 sm:px-6">
                  <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                    <button className="btn-secondary w-full sm:w-auto" type="button" onClick={closePaymentDialog} disabled={paymentSubmitting}>
                      Cancel
                    </button>
                    <button
                      className="btn-primary w-full sm:w-auto"
                      type="button"
                      onClick={confirmPaymentDialog}
                      disabled={paymentSubmitting || !paymentDialog.paymentMode || !paymentDialog.paidDate}
                    >
                      {paymentSubmitting ? "Saving..." : "Confirm Payment"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;
  const winnerSelectionModal =
    winnerMonth !== null
      ? createPortal(
          <div className="fixed inset-0 z-[120] bg-slate-950/60 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="winner-selection-title">
            <button className="absolute inset-0 h-full w-full cursor-default" type="button" aria-label="Close winner selection" onClick={() => setWinnerMonth(null)} />
            <div className="relative flex min-h-full items-center justify-center p-4 sm:p-6">
              <div className="flex max-h-[min(78dvh,42rem)] w-full max-w-lg flex-col overflow-hidden rounded-[28px] border border-border bg-surface shadow-2xl sm:rounded-[32px]">
                <div className="border-b border-border bg-muted/40 px-4 py-4 sm:px-6">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.3em] text-subtle">Winner picker</p>
                      <h2 id="winner-selection-title" className="mt-1.5 text-lg font-semibold sm:text-xl">Month {winnerMonth}</h2>
                    </div>
                    <button className="btn-secondary min-h-0 rounded-xl px-3 py-2 text-xs" type="button" onClick={() => setWinnerMonth(null)}>
                      Close
                    </button>
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-subtle">
                    Winner can be changed anytime. Select any member for this month and the dashboard will update immediately.
                  </p>
                </div>
                <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 [-webkit-overflow-scrolling:touch] sm:px-6 sm:py-6">
                  <div className="space-y-2">
                    {winnerCandidates.map((member) => (
                      <button
                        key={member.id}
                        className="group flex w-full items-center justify-between gap-3 rounded-2xl border border-border px-4 py-4 text-left transition hover:border-primary/40 hover:bg-muted/50 active:scale-[0.99]"
                        type="button"
                        onClick={async () => {
                          const result = await selectWinner(group.id, winnerMonth, member.id);
                          setMessage(result.ok ? `${member.name} is now the winner for Month ${winnerMonth}.` : result.message);
                          if (result.ok) setWinnerMonth(null);
                        }}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{member.name}</div>
                              <div className="truncate text-xs text-subtle">{getMemberContributorNames(member)} | {getMemberContributorPhones(member)}</div>
                        </div>
                        <Trophy size={16} className="shrink-0 text-warning" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <AppShell
        title={group.name}
        subtitle={`${group.totalMembers} member seats | ${totalContributors} contributors | ${formatCurrency(group.monthlyAmount)} per month`}
        backTo="/dashboard"
        stickyHeader={false}
        action={
          <div className="flex items-center gap-2">
            <button className="icon-btn active:scale-95" onClick={() => setEditing((value) => !value)} aria-label="Edit group">
              <Pencil size={16} />
            </button>
            <button className="icon-btn text-danger active:scale-95" onClick={() => setTab("summary")} aria-label="Delete group section">
              <Trash2 size={16} />
            </button>
          </div>
        }
      >
        <section className="card overflow-hidden p-0">
          <div className="h-1 w-full bg-gradient-to-r from-primary via-primary/60 to-transparent" />
          <div className="p-4 sm:p-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <span className="badge-muted">Started {formatDate(group.startDate)}</span>
                  <span className="badge-muted">{group.totalMembers} months</span>
                  <span className="badge-muted">{totalContributors} contributors</span>
                  <span className="badge-muted">Rate {(group.interestRate * 100).toFixed(3)}%</span>
                </div>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{group.name}</h2>
              </div>
              <div className="w-full lg:max-w-xs lg:text-right">
                <div className="mb-2 flex items-center justify-between text-xs text-subtle">
                  <span>Winner progress</span>
                  <span className="font-semibold text-text tabular-nums">{progress}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-2 rounded-full bg-primary transition-all duration-700 ease-out" style={{ width: `${progress}%` }} />
                </div>
                <p className="mt-1.5 text-xs text-subtle">
                  {group.months.filter((month) => month.winnerId).length} of {group.totalMembers} months have a winner selected
                </p>
              </div>
            </div>

            {editing && (
              <form className="mt-6 grid gap-3 rounded-2xl border border-border bg-muted/40 p-4 sm:grid-cols-2 sm:gap-4" onSubmit={submitGroupEdit}>
                <div>
                  <label className="label">Group name</label>
                  <input className="input" maxLength={50} value={groupDraft.name} onChange={(e) => setGroupDraft({ ...groupDraft, name: e.target.value })} placeholder="Enter group name" />
                </div>
                <div>
                  <label className="label">Payout day</label>
                  <input className="input" type="number" min="1" max="28" value={groupDraft.payoutDate} onChange={(e) => setGroupDraft({ ...groupDraft, payoutDate: Number(e.target.value) })} placeholder="1-28" />
                </div>
                <div>
                  <label className="label">Start date</label>
                  <input className="input" type="date" value={groupDraft.startDate} onChange={(e) => setGroupDraft({ ...groupDraft, startDate: e.target.value })} />
                </div>
                <div>
                  <label className="label">Monthly amount</label>
                  <input className="input" type="number" value={groupDraft.monthlyAmount} onChange={(e) => setGroupDraft({ ...groupDraft, monthlyAmount: Number(e.target.value) })} placeholder="500" />
                </div>
                <div>
                  <label className="label">Total members</label>
                  <input className="input" type="number" disabled value={groupDraft.totalMembers} onChange={(e) => setGroupDraft({ ...groupDraft, totalMembers: Number(e.target.value) })} placeholder="3" />
                </div>
                <div>
                  <label className="label">Interest rate %</label>
                  <input className="input" type="number" step="any" value={groupDraft.interestRatePercent} onChange={(e) => setGroupDraft({ ...groupDraft, interestRatePercent: Number(e.target.value) })} placeholder="1.0" />
                </div>
                <div className="sm:col-span-2 flex flex-wrap gap-1.5 text-xs text-subtle">
                  <span className="badge-muted">Locking is removed. Winners and contributor payments stay editable at any time.</span>
                </div>
                <div className="sm:col-span-2 flex flex-col gap-2 sm:flex-row">
                  <button className="btn-primary w-full sm:w-auto active:scale-[0.98]" type="submit">Save changes</button>
                  <button className="btn-secondary w-full sm:w-auto active:scale-[0.98]" type="button" onClick={() => setEditing(false)}>Cancel</button>
                </div>
              </form>
            )}
          </div>
        </section>

        <section className="mt-4 grid gap-3 sm:grid-cols-3">
          {[
            { label: "Collected", value: formatCurrency(totalCollected), accent: "text-success" },
            { label: "Expected", value: formatCurrency(totalExpected), accent: "text-text" },
            { label: "Contributors", value: totalContributors.toString(), accent: "text-primary" }
          ].map(({ label, value, accent }) => (
            <div key={label} className="card p-4 sm:p-5">
              <p className="text-xs uppercase tracking-wider text-subtle">{label}</p>
              <p className={`mt-2 text-2xl font-semibold tabular-nums ${accent}`}>{value}</p>
            </div>
          ))}
        </section>

        <section className="mt-4 overflow-x-auto rounded-2xl border border-border bg-surface/90 p-1.5">
          <div className="flex min-w-[320px] gap-1">
            {(["months", "members", "summary"] as const).map((item) => (
              <button
                key={item}
                className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
                  tab === item ? "bg-primary text-white shadow-sm" : "text-subtle hover:bg-muted hover:text-text"
                }`}
                onClick={() => setTab(item)}
              >
                {item[0].toUpperCase() + item.slice(1)}
              </button>
            ))}
          </div>
        </section>

        {message && <p className="mt-3 rounded-xl border border-primary/20 bg-primary/8 px-4 py-3 text-sm text-primary">{message}</p>}

        {tab === "months" && selectedMonth && (
          <section className="mt-4 space-y-4">
            <div className="card overflow-hidden p-0">
              <div className="border-b border-border bg-muted/20 px-4 py-3 sm:px-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.28em] text-subtle">Months</p>
                    <h3 className="mt-1 text-sm font-semibold sm:text-base">Select a month</h3>
                  </div>
                  <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-subtle">
                    {selectedMonthIndex + 1}/{group.months.length}
                  </span>
                </div>
              </div>
              <div className="mobile-scroll px-4 py-4 sm:px-5">
                <div className="flex min-w-max items-center gap-2">
                  {group.months.map((month, index) => {
                    const active = index === selectedMonthIndex;
                    const winner = group.members.find((member) => member.id === month.winnerId);
                    return (
                      <button
                        key={month.monthNumber}
                        type="button"
                        onClick={() => setSelectedMonthIndex(index)}
                        className={`group relative inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-all duration-200 ${
                          active
                            ? "border-primary bg-primary text-white shadow-lg shadow-orange-600/20"
                            : "border-border bg-surface text-subtle hover:border-primary/30 hover:bg-muted/70 hover:text-text"
                        }`}
                        aria-pressed={active}
                      >
                        <span>M{month.monthNumber}</span>
                        {winner && (
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${active ? "bg-white/18 text-white" : "bg-warning/12 text-warning"}`}>
                            Won
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {(() => {
              const month = selectedMonth;
              const winner = group.members.find((member) => member.id === month.winnerId);
              const paidContributors = month.payments.reduce((sum, payment) => sum + getPaidContributorCount(payment), 0);
              const contributorCount = month.payments.reduce((sum, payment) => sum + payment.subPayments.length, 0);

              return (
                <article key={month.monthNumber} className="card overflow-hidden transition-all duration-300 ease-out motion-reduce:transition-none">
                  <div className="border-b border-border bg-muted/30 px-4 py-4 sm:px-5">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-semibold sm:text-lg">Month {month.monthNumber}</h3>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${winner ? "bg-warning/12 text-warning" : "bg-muted text-subtle"}`}>
                            {winner ? `Winner: ${winner.name}` : "Winner open"}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-subtle">
                          {paidContributors}/{contributorCount} contributors paid | {formatCurrency(sumCollectedForMonth(group, month.monthNumber))} collected | {formatCurrency(month.expectedAmount)} per member seat
                        </p>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <button className="btn-secondary text-xs sm:w-auto" type="button" onClick={() => setWinnerMonth(month.monthNumber)}>
                          <Trophy size={14} />
                          {winner ? "Change winner" : "Choose winner"}
                        </button>
                        <button
                          className="btn-secondary text-xs sm:w-auto"
                          type="button"
                          onClick={async () => {
                            openPaymentDialog({
                              title: `Mark all contributors paid for Month ${month.monthNumber}`,
                              subtitle: "Choose how this month payment was collected before confirming.",
                              paymentMode: "offline",
                              paidDate: todayIso(),
                              onConfirm: async (details) => {
                                const result = await markAllPaid(group.id, month.monthNumber, {
                                  mode: details.paymentMode,
                                  paidDate: details.paidDate
                                });
                                setMessage(result.message);
                              }
                            });
                          }}
                        >
                          <CheckCircle2 size={14} />
                          Mark all contributors paid
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 p-4 sm:p-5">
                    {month.payments.map((payment) => {
                      const member = group.members.find((entry) => entry.id === payment.memberId)!;
                      return (
                        <div key={payment.memberId} className="rounded-[24px] border border-border bg-surface/80 p-4">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <div className="flex items-center gap-2">
                                <h4 className="text-sm font-semibold text-text sm:text-base">{member.name}</h4>
                                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${isPaymentFullyPaid(payment) ? "bg-success/12 text-success" : getCollectedAmountForPayment(payment) > 0 ? "bg-warning/12 text-warning" : "bg-muted text-subtle"}`}>
                                  {isPaymentFullyPaid(payment) ? "Paid" : getCollectedAmountForPayment(payment) > 0 ? "Partial" : "Unpaid"}
                                </span>
                              </div>
                              <div className="truncate text-xs text-subtle">{getMemberContributorNames(member)} | {getMemberContributorPhones(member)}</div>
                            </div>
                            <div className="text-xs text-subtle sm:text-right">
                              <div>{formatCurrency(getCollectedAmountForPayment(payment))} collected</div>
                              <div>{formatCurrency(month.expectedAmount)} expected</div>
                            </div>
                          </div>

                          <div className="mt-4 grid gap-3">
                            {payment.subPayments.map((subPayment) => {
                              const contributor = member.contributors.find((entry) => entry.id === subPayment.contributorId);
                              if (!contributor) return null;
                              return (
                                <div key={subPayment.contributorId} className="rounded-2xl border border-border bg-muted/50 px-3 py-3">
                                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                      <p className="text-sm font-medium text-text">{contributor.name}</p>
                                      <p className="mt-1 text-xs text-subtle">{contributor.phone}</p>
                                    </div>
                                    <div className="flex flex-col gap-2 sm:items-end">
                                      <div className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${subPayment.paid ? "bg-success/12 text-success" : "bg-muted text-subtle"}`}>
                                        {subPayment.paid ? <CheckCircle2 size={13} /> : <Circle size={13} />}
                                        {subPayment.paid ? "Paid" : "Unpaid"}
                                      </div>
                                      <div className="text-xs text-subtle">Share {formatCurrency(subPayment.paidAmount ?? 0)}</div>
                                    </div>
                                  </div>
                                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="text-xs text-subtle">
                                      {subPayment.paid ? `Paid ${subPayment.paidDate ?? todayIso()} via ${subPayment.paymentMode ?? "offline"}` : "Waiting for payment"}
                                    </div>
                                    <button
                                      className={subPayment.paid ? "btn-secondary text-xs" : "btn-primary text-xs"}
                                      type="button"
                                      onClick={async () => {
                                        if (subPayment.paid) {
                                          const result = await updatePayment(group.id, month.monthNumber, payment.memberId, subPayment.contributorId, {
                                            paid: false,
                                            paidAmount: subPayment.paidAmount
                                          });
                                          setMessage(result.message);
                                          return;
                                        }

                                        openPaymentDialog({
                                          title: `Mark ${contributor.name} as paid`,
                                          subtitle: `${member.name} | Month ${month.monthNumber}`,
                                          paymentMode: subPayment.paymentMode ?? "offline",
                                          paidDate: subPayment.paidDate ?? todayIso(),
                                          onConfirm: async (details) => {
                                            const result = await updatePayment(group.id, month.monthNumber, payment.memberId, subPayment.contributorId, {
                                              paid: true,
                                              paidDate: details.paidDate,
                                              paymentMode: details.paymentMode,
                                              paidAmount: subPayment.paidAmount
                                            });
                                            setMessage(result.message);
                                          }
                                        });
                                      }}
                                    >
                                      {subPayment.paid ? "Mark unpaid" : "Mark paid"}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </article>
              );
            })()}
          </section>
        )}
        {tab === "members" && (
          <section className="mt-4 grid gap-3 lg:grid-cols-2">
            {group.members.map((member) => {
              const paid = getMemberPaidTotal(group, member.id);
              const expected = getMemberExpectedTotal(group, member.id);
              const memberProgress = expected > 0 ? Math.round((paid / expected) * 100) : 0;
              return (
                <article key={member.id} className="card p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">{member.name}</h3>
                              <div className="truncate text-xs text-subtle">{getMemberContributorNames(member)} | {getMemberContributorPhones(member)}</div>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${member.hasWon ? "bg-warning/12 text-warning" : "bg-muted text-subtle"}`}>
                      {member.hasWon ? `Winner M${member.payoutMonth}` : "No winner month"}
                    </span>
                  </div>

                  <div className="mt-3">
                    <div className="mb-1.5 flex justify-between text-xs text-subtle">
                      <span className="tabular-nums">{formatCurrency(paid)} collected</span>
                      <span className="tabular-nums">{formatCurrency(expected)} expected</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-1.5 rounded-full bg-primary transition-all duration-500" style={{ width: `${memberProgress}%` }} />
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    {member.contributors.map((contributor) => {
                      const paidMonths = group.months.filter((month) => {
                        const payment = month.payments.find((entry) => entry.memberId === member.id);
                        return payment?.subPayments.some((entry) => entry.contributorId === contributor.id && entry.paid);
                      }).length;
                      return (
                        <div key={contributor.id} className="rounded-xl bg-muted/60 px-3 py-2 text-xs">
                          <div className="font-medium text-text">{contributor.name}</div>
                          <div className="mt-1 flex items-center justify-between gap-3 text-subtle">
                            <span>{contributor.phone}</span>
                            <span>{paidMonths}/{group.months.length} months paid</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </section>
        )}

        {tab === "summary" && (
          <section className="mt-4 space-y-4">
            <div className="card overflow-x-auto p-0">
              <div className="border-b border-border px-4 py-3 sm:px-5">
                <h3 className="text-sm font-semibold">Monthly overview</h3>
              </div>
              <div className="overflow-x-auto p-4 sm:p-5">
                <table className="min-w-[720px] w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-subtle">
                      <th className="px-3 py-2">Month</th>
                      <th className="px-3 py-2">Winner</th>
                      <th className="px-3 py-2">Contributors Paid</th>
                      <th className="px-3 py-2">Collected</th>
                      <th className="px-3 py-2">Expected / Member</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {group.months.map((month) => {
                      const winner = group.members.find((member) => member.id === month.winnerId);
                      const paidContributors = month.payments.reduce((sum, payment) => sum + getPaidContributorCount(payment), 0);
                      const contributorCount = month.payments.reduce((sum, payment) => sum + payment.subPayments.length, 0);
                      return (
                        <tr key={month.monthNumber} className="hover:bg-muted/20 transition-colors">
                          <td className="px-3 py-3 font-medium">Month {month.monthNumber}</td>
                          <td className="px-3 py-3 text-subtle">{winner ? winner.name : "Not selected"}</td>
                          <td className="px-3 py-3 text-subtle">{paidContributors}/{contributorCount}</td>
                          <td className="px-3 py-3">{formatCurrency(sumCollectedForMonth(group, month.monthNumber))}</td>
                          <td className="px-3 py-3">{formatCurrency(month.expectedAmount)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card p-4 sm:p-5">
              <h3 className="mb-3 text-sm font-semibold">Export data</h3>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button className="btn-secondary inline-flex items-center justify-center gap-2 w-full sm:w-auto" onClick={() => exportGroupCsv(group)}>
                  <Download size={14} /> Export CSV
                </button>
                <button className="btn-secondary inline-flex items-center justify-center gap-2 w-full sm:w-auto" onClick={() => exportGroupPdf(group)}>
                  <FileText size={14} /> Export PDF
                </button>
              </div>
            </div>

            <div className="card border-danger/25 p-4 sm:p-5">
              <div className="mb-1 flex items-center gap-2">
                <Trash2 size={15} className="text-danger" />
                <h3 className="text-sm font-semibold text-danger">Delete group</h3>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-subtle">
                This action is permanent and cannot be undone. Type <strong className="text-text">{group.name}</strong> to confirm.
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input className="input max-w-sm text-sm" value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} placeholder={group.name} />
                <button className="btn-danger inline-flex items-center justify-center gap-2 w-full sm:w-auto" type="button" disabled={!canDelete || pendingAction === "delete"} onClick={handleDeleteGroup}>
                  {pendingAction === "delete" ? "Deleting..." : "Delete permanently"}
                </button>
              </div>
            </div>
          </section>
        )}
      </AppShell>
      {paymentDetailModal}
      {winnerSelectionModal}
    </>
  );
}


