import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { BhishiGroup, ContributorPayment, GroupDraft, Member, MemberContributor, MemberDraft, MonthRecord, Payment } from "../types";
import { calculatePayment } from "./calculatePayment";
import { formatCurrency, formatDate, payoutDayLabel } from "./format";

export const uid = () => crypto.randomUUID();

export const getMemberContributors = (member: Pick<Member, "id" | "name" | "phone" | "contributors">): MemberContributor[] => {
  if (member.contributors?.length) return member.contributors;
  return [{ id: `${member.id}-primary`, name: member.name, phone: member.phone }];
};

export const getDraftMemberContributors = (member: Pick<MemberDraft, "id" | "name" | "phone" | "contributors">): MemberContributor[] => {
  if (member.contributors?.length) return member.contributors;
  return [{ id: `${member.id}-primary`, name: member.name, phone: member.phone }];
};

export const getMemberContributorNames = (member: Pick<Member, "id" | "name" | "phone" | "contributors">) =>
  getMemberContributors(member)
    .map((contributor) => contributor.name)
    .join(", ");

export const getMemberContributorPhones = (member: Pick<Member, "id" | "name" | "phone" | "contributors">) =>
  getMemberContributors(member)
    .map((contributor) => contributor.phone)
    .join(", ");

export const getPrimaryContributorPhone = (member: Pick<Member, "id" | "name" | "phone" | "contributors">) =>
  getMemberContributors(member)[0]?.phone ?? member.phone;

export const createContributorSubPayments = (totalAmount: number, contributors: MemberContributor[]): ContributorPayment[] => {
  if (contributors.length === 0) return [];
  const totalCents = Math.round(totalAmount * 100);
  const baseCents = Math.floor(totalCents / contributors.length);
  const remainder = totalCents % contributors.length;

  return contributors.map((contributor, index) => ({
    contributorId: contributor.id,
    paid: false,
    paidAmount: (baseCents + (index < remainder ? 1 : 0)) / 100
  }));
};

export const getCollectedAmountForPayment = (payment: Payment) => {
  if (payment.subPayments?.length) {
    return payment.subPayments.reduce((sum, subPayment) => sum + (subPayment.paid ? subPayment.paidAmount ?? 0 : 0), 0);
  }

  return payment.paid ? payment.paidAmount ?? 0 : 0;
};

export const isPaymentFullyPaid = (payment: Payment) => {
  if (payment.subPayments?.length) {
    return payment.subPayments.every((subPayment) => subPayment.paid);
  }

  return payment.paid;
};

export const getPaidContributorCount = (payment: Payment) => {
  if (payment.subPayments?.length) {
    return payment.subPayments.filter((subPayment) => subPayment.paid).length;
  }

  return payment.paid ? 1 : 0;
};

export const createMonths = (draft: GroupDraft): MonthRecord[] =>
  Array.from({ length: draft.totalMembers }, (_, index) => {
    const monthNumber = index + 1;
    const expectedAmount = calculatePayment(
      draft.monthlyAmount,
      draft.interestRatePercent / 100,
      draft.totalMembers,
      monthNumber
    );

    return {
      monthNumber,
      expectedAmount,
      isLocked: false,
      payments: draft.members.map((member) => ({
        memberId: member.id,
        paid: false,
        paidAmount: 0,
        subPayments: createContributorSubPayments(expectedAmount, getDraftMemberContributors(member))
      }))
    };
  });

export const canManageMonth = () => true;

export const getGroupProgress = (group: BhishiGroup) => {
  const assignedWinners = group.months.filter((month) => month.winnerId).length;
  return Math.round((assignedWinners / Math.max(group.totalMembers, 1)) * 100);
};

export const sumCollectedForMonth = (group: BhishiGroup, monthNumber: number) => {
  const month = group.months.find((entry) => entry.monthNumber === monthNumber);
  if (!month) return 0;

  return month.payments.reduce((sum, payment) => sum + getCollectedAmountForPayment(payment), 0);
};

export const sumExpectedForGroup = (group: BhishiGroup) =>
  group.months.reduce((sum, month) => sum + month.expectedAmount * group.totalMembers, 0);

export const sumCollectedForGroup = (group: BhishiGroup) =>
  group.months.reduce((sum, month) => sum + sumCollectedForMonth(group, month.monthNumber), 0);

export const paymentsStarted = (group: BhishiGroup) =>
  group.months.some((month) => month.payments.some((payment) => getCollectedAmountForPayment(payment) > 0));

export const monthOneLocked = () => false;

export const recalculateCompletion = (group: BhishiGroup) => ({
  ...group,
  isCompleted: group.months.every((month) => Boolean(month.winnerId))
});

export const getMemberPaidTotal = (group: BhishiGroup, memberId: string) =>
  group.months.reduce((sum, month) => {
    const payment = month.payments.find((entry) => entry.memberId === memberId);
    return sum + (payment ? getCollectedAmountForPayment(payment) : 0);
  }, 0);

export const getMemberExpectedTotal = (group: BhishiGroup, memberId: string) =>
  group.months.reduce((sum, month) => {
    const payment = month.payments.find((entry) => entry.memberId === memberId);
    return sum + (payment ? month.expectedAmount : 0);
  }, 0);

export const exportGroupCsv = (group: BhishiGroup) => {
  const header = ["Member", "Contributors", "Phones", ...group.months.map((month) => `Month ${month.monthNumber}`), "Total Paid"];
  const rows = group.members.map((member) => {
    const statuses = group.months.map((month) => {
      const payment = month.payments.find((entry) => entry.memberId === member.id);
      if (!payment) return "-";
      if (isPaymentFullyPaid(payment)) return "Paid";
      if (getCollectedAmountForPayment(payment) > 0) return "Partial";
      return "Unpaid";
    });

    return [
      member.name,
      getMemberContributorNames(member),
      getMemberContributorPhones(member),
      ...statuses,
      getMemberPaidTotal(group, member.id).toString()
    ];
  });

  const csv = [header, ...rows]
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${group.name.replace(/\s+/g, "-").toLowerCase()}-summary.csv`;
  link.click();
  URL.revokeObjectURL(url);
};

const sanitizeFilename = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "group-summary";

export const exportGroupPdf = (group: BhishiGroup) => {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const generatedAt = new Date().toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  });

  doc.setFillColor(24, 20, 16);
  doc.rect(0, 0, pageWidth, 118, "F");
  doc.setTextColor(255, 250, 244);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text(group.name, 40, 48);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Bhishi Group Report", 40, 68);
  doc.text(`Generated ${generatedAt}`, 40, 84);

  autoTable(doc, {
    startY: 132,
    theme: "grid",
    head: [["Members", "Monthly Amount", "Start Date", "Payout Day", "Interest Rate", "Collected"]],
    body: [[
      String(group.totalMembers),
      formatCurrency(group.monthlyAmount),
      formatDate(group.startDate),
      payoutDayLabel(group.payoutDate),
      `${(group.interestRate * 100).toFixed(1)}%`,
      formatCurrency(sumCollectedForGroup(group))
    ]],
    styles: {
      font: "helvetica",
      fontSize: 10,
      cellPadding: 8,
      lineColor: [225, 214, 199],
      lineWidth: 0.5,
      textColor: [34, 24, 20]
    },
    headStyles: {
      fillColor: [180, 83, 9],
      textColor: [255, 255, 255],
      fontStyle: "bold"
    },
    bodyStyles: {
      fillColor: [255, 252, 247]
    },
    margin: { left: 40, right: 40 }
  });

  const monthlyRows = group.months.map((month) => {
    const winner = group.members.find((member) => member.id === month.winnerId);
    const paidCount = month.payments.reduce((sum, payment) => sum + getPaidContributorCount(payment), 0);
    const totalContributors = month.payments.reduce((sum, payment) => sum + (payment.subPayments?.length ?? 1), 0);
    const status = winner ? "Winner Selected" : "Open";

    return [
      `Month ${month.monthNumber}`,
      `${paidCount}/${totalContributors}`,
      formatCurrency(month.expectedAmount),
      winner ? winner.name : "-",
      formatCurrency(sumCollectedForMonth(group, month.monthNumber)),
      status
    ];
  });

  autoTable(doc, {
    startY: (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ? (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable!.finalY + 24 : 220,
    theme: "striped",
    head: [["Month", "Contributors Paid", "Expected / Member", "Winner", "Collected", "Status"]],
    body: monthlyRows,
    styles: {
      font: "helvetica",
      fontSize: 10,
      cellPadding: 7,
      textColor: [34, 24, 20]
    },
    headStyles: {
      fillColor: [36, 31, 27],
      textColor: [255, 255, 255],
      fontStyle: "bold"
    },
    alternateRowStyles: {
      fillColor: [249, 244, 236]
    },
    bodyStyles: {
      fillColor: [255, 252, 247]
    },
    margin: { left: 40, right: 40 }
  });

  const memberRows = group.members.map((member) => [
    member.name,
    getMemberContributorNames(member),
    getMemberContributorPhones(member),
    formatCurrency(getMemberPaidTotal(group, member.id)),
    member.payoutMonth ? `Month ${member.payoutMonth}` : "Not yet selected",
    member.hasWon ? "Won" : "Open"
  ]);

  autoTable(doc, {
    startY: (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ? (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable!.finalY + 24 : 320,
    theme: "striped",
    head: [["Member", "Contributors", "Phones", "Total Paid", "Payout Month", "Status"]],
    body: memberRows,
    styles: {
      font: "helvetica",
      fontSize: 10,
      cellPadding: 7,
      textColor: [34, 24, 20]
    },
    headStyles: {
      fillColor: [21, 128, 61],
      textColor: [255, 255, 255],
      fontStyle: "bold"
    },
    alternateRowStyles: {
      fillColor: [245, 250, 247]
    },
    bodyStyles: {
      fillColor: [255, 255, 255]
    },
    margin: { left: 40, right: 40 },
    didDrawPage: () => {
      const pageHeight = doc.internal.pageSize.getHeight();
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(108, 91, 77);
      doc.text("Bhishi Admin", 40, pageHeight - 24);
      doc.text(`Page ${doc.getCurrentPageInfo().pageNumber}`, pageWidth - 72, pageHeight - 24);
    }
  });

  doc.save(`${sanitizeFilename(group.name)}-summary.pdf`);
};

