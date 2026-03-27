import { create } from "zustand";
import { Admin, BhishiGroup, GroupDraft, GroupUpdateInput, Payment, PaymentUpdateInput, Session } from "../types";
import { todayIso } from "../utils/format";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import {
  changeRemotePassword,
  updateRemoteAdminPreferences
} from "../services/supabaseAuth";
import {
  createRemoteGroup,
  deleteRemoteGroup,
  fetchGroupSnapshotById,
  fetchGroupSnapshots,
  mapRemoteGroup,
  markAllRemotePaymentsPaid,
  recordRemotePayment,
  selectRemoteWinner,
  updateRemoteGroup
} from "../services/supabaseGroups";
import { calculatePayment } from "../utils/calculatePayment";
import {
  createContributorSubPayments,
  createMonths,
  getCollectedAmountForPayment,
  getMemberContributors,
  recalculateCompletion,
  uid
} from "../utils/helpers";

type PaymentMode = "online" | "offline";
type ThemeMode = Admin["theme"];
type Language = Admin["language"];

interface MutationResult {
  ok: boolean;
  message: string;
}

interface AppState {
  admin: Admin | null;
  session: Session | null;
  groups: BhishiGroup[];
  visitCount: number;
  installBannerDismissed: boolean;
  boot: () => Promise<void>;
  setupAdmin: (email: string, password: string) => void;
  login: (email: string, password: string) => boolean;
  hydrateRemoteAuth: (payload: { adminId: string; email: string; token?: string; language?: Language; theme?: ThemeMode }) => void;
  clearAuthState: () => void;
  logout: () => void;
  replaceGroups: (groups: BhishiGroup[]) => void;
  upsertGroup: (group: BhishiGroup) => void;
  createGroup: (draft: GroupDraft) => Promise<string>;
  updateGroup: (groupId: string, input: GroupUpdateInput) => Promise<MutationResult>;
  updateTheme: (theme: ThemeMode) => Promise<MutationResult>;
  updateLanguage: (language: Language) => Promise<MutationResult>;
  changePassword: (currentPassword: string, nextPassword: string) => Promise<MutationResult>;
  deleteAccount: () => Promise<void>;
  updatePayment: (groupId: string, monthNumber: number, memberId: string, contributorId: string, input: PaymentUpdateInput) => Promise<MutationResult>;
  markAllPaid: (groupId: string, monthNumber: number, input: { mode: PaymentMode; paidDate?: string }) => Promise<MutationResult>;
  selectWinner: (groupId: string, monthNumber: number, memberId: string) => Promise<MutationResult>;
  lockMonth: (groupId: string, monthNumber: number) => Promise<MutationResult>;
  deleteGroup: (groupId: string) => Promise<MutationResult>;
  dismissInstallBanner: () => void;
}

type PersistedState = Pick<AppState, "admin" | "session" | "groups" | "visitCount" | "installBannerDismissed">;

const storageKey = "bhishi-admin-app";

const persist = (state: PersistedState) => {
  localStorage.setItem(storageKey, JSON.stringify(state));
};

const recomputePayment = (payment: Payment): Payment => {
  const collected = getCollectedAmountForPayment(payment);
  const paid = payment.subPayments.length > 0 ? payment.subPayments.every((subPayment) => subPayment.paid) : payment.paid;
  return {
    ...payment,
    paid,
    paidAmount: collected,
    paidDate: paid ? payment.subPayments.find((subPayment) => subPayment.paidDate)?.paidDate ?? payment.paidDate : undefined,
    paymentMode: paid ? payment.subPayments.find((subPayment) => subPayment.paymentMode)?.paymentMode ?? payment.paymentMode : undefined
  };
};

const recomputeMemberWins = (group: BhishiGroup): BhishiGroup => {
  const memberPayouts = new Map<string, number[]>();
  for (const month of group.months) {
    if (!month.winnerId) continue;
    const months = memberPayouts.get(month.winnerId) ?? [];
    months.push(month.monthNumber);
    memberPayouts.set(month.winnerId, months);
  }

  return recalculateCompletion({
    ...group,
    members: group.members.map((member) => {
      const payouts = memberPayouts.get(member.id) ?? [];
      return {
        ...member,
        hasWon: payouts.length > 0,
        payoutMonth: payouts.length > 0 ? Math.min(...payouts) : undefined
      };
    })
  });
};

const normalizeGroups = (groups: BhishiGroup[]) =>
  groups.map((group) => {
    const members = group.members.map((member) => {
      const contributors = getMemberContributors(member).map((contributor, index) => ({
        id: contributor.id ?? `${member.id}-contributor-${index + 1}`,
        name: contributor.name,
        phone: contributor.phone
      }));

      return {
        ...member,
        phone: contributors[0]?.phone ?? member.phone,
        contributors
      };
    });

    const months = group.months.map((month) => ({
      ...month,
      isLocked: false,
      lockedAt: undefined,
      payments: month.payments.map((payment) => {
        const member = members.find((entry) => entry.id === payment.memberId);
        const subPayments = payment.subPayments?.length
          ? payment.subPayments
          : createContributorSubPayments(month.expectedAmount, member?.contributors ?? []).map((subPayment) => ({
              ...subPayment,
              paid: payment.paid,
              paidDate: payment.paid ? payment.paidDate : undefined,
              paymentMode: payment.paid ? payment.paymentMode : undefined
            }));

        return recomputePayment({
          ...payment,
          subPayments
        });
      })
    }));

    return recomputeMemberWins({
      ...group,
      members,
      months
    });
  });

const readStorage = () => {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as PersistedState;
    return {
      ...parsed,
      groups: normalizeGroups(parsed.groups ?? [])
    };
  } catch {
    return null;
  }
};

const resolvePersistedState = (current: AppState, patch: Partial<PersistedState>): PersistedState => ({
  admin: patch.admin !== undefined ? patch.admin : current.admin,
  session: patch.session !== undefined ? patch.session : current.session,
  groups: patch.groups !== undefined ? patch.groups : current.groups,
  visitCount: patch.visitCount !== undefined ? patch.visitCount : current.visitCount,
  installBannerDismissed: patch.installBannerDismissed !== undefined ? patch.installBannerDismissed : current.installBannerDismissed
});

const writePersistedState = (
  get: () => AppState,
  set: (partial: Partial<AppState>) => void,
  patch: Partial<PersistedState>
) => {
  const next = resolvePersistedState(get(), patch);
  set(next);
  persist(next);
  return next;
};

const replaceGroup = (groups: BhishiGroup[], nextGroup: BhishiGroup) => [
  nextGroup,
  ...groups.filter((group) => group.id !== nextGroup.id)
];

const recalculateDraftFinancials = (group: BhishiGroup, input: GroupUpdateInput) => {
  const nextMonthlyAmount = input.monthlyAmount ?? group.monthlyAmount;
  const nextInterestRate = input.interestRatePercent !== undefined ? input.interestRatePercent / 100 : group.interestRate;

  return recalculateCompletion({
    ...group,
    name: input.name.trim(),
    payoutDate: input.payoutDate,
    startDate: input.startDate,
    monthlyAmount: nextMonthlyAmount,
    interestRate: nextInterestRate,
    months: group.months.map((month) => {
      const expectedAmount = calculatePayment(nextMonthlyAmount, nextInterestRate, group.totalMembers, month.monthNumber);

      return {
        ...month,
        expectedAmount,
        payments: month.payments.map((payment) => {
          const member = group.members.find((entry) => entry.id === payment.memberId)!;
          const nextSubPayments = createContributorSubPayments(expectedAmount, member.contributors).map((subPayment) => {
            const existing = payment.subPayments.find((entry) => entry.contributorId === subPayment.contributorId);
            return existing
              ? {
                  ...existing,
                  paidAmount: subPayment.paidAmount
                }
              : subPayment;
          });

          return recomputePayment({
            ...payment,
            subPayments: nextSubPayments
          });
        })
      };
    })
  });
};

export const useAppStore = create<AppState>((set, get) => ({
  admin: null,
  session: null,
  groups: [],
  visitCount: 0,
  installBannerDismissed: false,
  boot: async () => {
    const stored = readStorage();
    if (!stored) {
      const initial: PersistedState = {
        admin: null,
        session: null,
        groups: [],
        visitCount: 1,
        installBannerDismissed: false
      };
      set(initial);
      persist(initial);
      return;
    }

    const snapshot: PersistedState = {
      ...stored,
      visitCount: stored.visitCount + 1
    };
    set(snapshot);
    persist(snapshot);

    if (!isSupabaseConfigured || !supabase || !stored.session) return;

    try {
      const remoteGroups = await fetchGroupSnapshots();
      writePersistedState(get, set, { groups: normalizeGroups(remoteGroups.map(mapRemoteGroup)) });
    } catch (error) {
      console.error("Failed to sync with Supabase:", error);
    }
  },
  setupAdmin: (email, password) => {
    const admin: Admin = {
      id: uid(),
      email,
      password,
      createdAt: new Date().toISOString(),
      language: "en",
      theme: "system"
    };
    const session: Session = { adminId: admin.id, token: uid() };
    writePersistedState(get, set, { admin, session });
  },
  login: (email, password) => {
    const admin = get().admin;
    if (!admin || admin.email !== email || admin.password !== password) {
      return false;
    }

    writePersistedState(get, set, {
      admin,
      session: { adminId: admin.id, token: uid() }
    });
    return true;
  },
  hydrateRemoteAuth: ({ adminId, email, token, language, theme }) => {
    const currentAdmin = get().admin;
    const admin: Admin = {
      id: adminId,
      email,
      password: currentAdmin?.id === adminId ? currentAdmin.password : "",
      createdAt: currentAdmin?.id === adminId ? currentAdmin.createdAt : new Date().toISOString(),
      language: language ?? (currentAdmin?.id === adminId ? currentAdmin.language : "en"),
      theme: theme ?? (currentAdmin?.id === adminId ? currentAdmin.theme : "system")
    };
    const session: Session = { adminId, token: token ?? uid() };
    writePersistedState(get, set, { admin, session });
  },
  clearAuthState: () => {
    writePersistedState(get, set, { session: null });
  },
  logout: () => {
    writePersistedState(get, set, { session: null });
  },
  replaceGroups: (groups) => {
    writePersistedState(get, set, { groups: normalizeGroups(groups) });
  },
  upsertGroup: (group) => {
    writePersistedState(get, set, { groups: replaceGroup(get().groups, normalizeGroups([group])[0]) });
  },
  createGroup: async (draft) => {
    try {
      if (isSupabaseConfigured && supabase && get().session) {
        const groupId = await createRemoteGroup(draft);
        const row = await fetchGroupSnapshotById(groupId);
        writePersistedState(get, set, { groups: replaceGroup(get().groups, normalizeGroups([mapRemoteGroup(row)])[0]) });
        return groupId;
      }

      const group: BhishiGroup = {
        id: uid(),
        name: draft.name.trim(),
        monthlyAmount: draft.monthlyAmount,
        totalMembers: draft.totalMembers,
        interestRate: draft.interestRatePercent / 100,
        startDate: draft.startDate,
        payoutDate: draft.payoutDate,
        members: draft.members.map((member) => ({
          id: member.id,
          name: member.name.trim(),
          phone: member.phone.trim(),
          contributors: member.contributors.map((contributor) => ({
            id: contributor.id,
            name: contributor.name.trim(),
            phone: contributor.phone.trim()
          })),
          hasWon: false
        })),
        months: createMonths(draft),
        createdAt: new Date().toISOString(),
        isCompleted: false
      };

      writePersistedState(get, set, { groups: [normalizeGroups([group])[0], ...get().groups] });
      return group.id;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "Failed to create group.");
    }
  },
  updateGroup: async (groupId, input) => {
    const group = get().groups.find((entry) => entry.id === groupId);
    if (!group) return { ok: false, message: "Group not found." };

    const trimmedName = input.name.trim();
    if (!trimmedName) return { ok: false, message: "Group name is required." };
    if (!input.startDate) return { ok: false, message: "Start date is required." };
    if (input.payoutDate < 1 || input.payoutDate > 28) return { ok: false, message: "Payout day must be between 1 and 28." };
    if (input.monthlyAmount !== undefined && (!Number.isFinite(input.monthlyAmount) || input.monthlyAmount <= 0)) {
      return { ok: false, message: "Monthly amount must be greater than 0." };
    }
    if (input.interestRatePercent !== undefined && (input.interestRatePercent < 0 || input.interestRatePercent > 10)) {
      return { ok: false, message: "Interest rate must be between 0 and 10." };
    }
    if (input.totalMembers !== undefined && input.totalMembers !== group.totalMembers) {
      return { ok: false, message: "Changing total members requires recreating the group with the correct roster." };
    }

    try {
      let nextGroup: BhishiGroup;

      if (isSupabaseConfigured && supabase && get().session) {
        const row = await updateRemoteGroup(groupId, input);
        nextGroup = mapRemoteGroup(row);
      } else {
        nextGroup = recalculateDraftFinancials(group, input);
      }

      writePersistedState(get, set, { groups: replaceGroup(get().groups, normalizeGroups([nextGroup])[0]) });
      return { ok: true, message: "Group updated." };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Failed to update group." };
    }
  },
  updateTheme: async (theme) => {
    const admin = get().admin;
    if (!admin) return { ok: false, message: "Admin not found." };

    try {
      let nextAdmin: Admin = { ...admin, theme };

      if (isSupabaseConfigured && supabase && get().session) {
        const profile = await updateRemoteAdminPreferences({ theme });
        nextAdmin = {
          ...nextAdmin,
          email: profile.email,
          theme: profile.preferred_theme,
          language: profile.preferred_language
        };
      }

      writePersistedState(get, set, { admin: nextAdmin });
      return { ok: true, message: "Theme updated." };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Failed to update theme." };
    }
  },
  updateLanguage: async (language) => {
    const admin = get().admin;
    if (!admin) return { ok: false, message: "Admin not found." };

    try {
      let nextAdmin: Admin = { ...admin, language };

      if (isSupabaseConfigured && supabase && get().session) {
        const profile = await updateRemoteAdminPreferences({ language });
        nextAdmin = {
          ...nextAdmin,
          email: profile.email,
          theme: profile.preferred_theme,
          language: profile.preferred_language
        };
      }

      writePersistedState(get, set, { admin: nextAdmin });
      return { ok: true, message: "Language updated." };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Failed to update language." };
    }
  },
  changePassword: async (currentPassword, nextPassword) => {
    const admin = get().admin;
    if (!admin) return { ok: false, message: "Admin not found." };

    try {
      if (isSupabaseConfigured && supabase && get().session) {
        await changeRemotePassword(currentPassword, nextPassword);
      } else if (admin.password !== currentPassword) {
        return { ok: false, message: "Current password is incorrect." };
      }

      writePersistedState(get, set, { admin: { ...admin, password: nextPassword } });
      return { ok: true, message: "Password updated." };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Failed to update password." };
    }
  },
  deleteAccount: async () => {
    writePersistedState(get, set, {
      admin: null,
      session: null,
      groups: [],
      visitCount: 0,
      installBannerDismissed: false
    });
  },
  updatePayment: async (groupId, monthNumber, memberId, contributorId, input) => {
    const group = get().groups.find((entry) => entry.id === groupId);
    const month = group?.months.find((entry) => entry.monthNumber === monthNumber);
    if (!group || !month) return { ok: false, message: "Month not found." };

    try {
      let nextGroup: BhishiGroup;

      if (isSupabaseConfigured && supabase && get().session) {
        await recordRemotePayment(groupId, monthNumber, memberId, contributorId, {
          paid: input.paid,
          paidDate: input.paid ? input.paidDate ?? todayIso() : undefined,
          paymentMode: input.paid ? input.paymentMode ?? "offline" : undefined,
          paidAmount: input.paidAmount
        });
        nextGroup = mapRemoteGroup(await fetchGroupSnapshotById(groupId));
      } else {
        nextGroup = recomputeMemberWins({
          ...group,
          months: group.months.map((entry) => {
            if (entry.monthNumber !== monthNumber) return entry;
            return {
              ...entry,
              payments: entry.payments.map((payment) => {
                if (payment.memberId !== memberId) return payment;
                const nextSubPayments = payment.subPayments.map((subPayment) => {
                  if (subPayment.contributorId !== contributorId) return subPayment;
                  return {
                    ...subPayment,
                    paid: input.paid,
                    paidDate: input.paid ? input.paidDate ?? subPayment.paidDate ?? todayIso() : undefined,
                    paymentMode: input.paid ? input.paymentMode ?? subPayment.paymentMode ?? "offline" : undefined,
                    paidAmount: input.paidAmount ?? subPayment.paidAmount
                  };
                });
                return recomputePayment({
                  ...payment,
                  subPayments: nextSubPayments
                });
              })
            };
          })
        });
      }

      writePersistedState(get, set, { groups: replaceGroup(get().groups, normalizeGroups([nextGroup])[0]) });
      return { ok: true, message: "Contributor payment updated." };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Failed to update payment." };
    }
  },
  markAllPaid: async (groupId, monthNumber, input) => {
    const group = get().groups.find((entry) => entry.id === groupId);
    const month = group?.months.find((entry) => entry.monthNumber === monthNumber);
    if (!group || !month) return { ok: false, message: "Month not found." };

    try {
      let nextGroup: BhishiGroup;

      if (isSupabaseConfigured && supabase && get().session) {
        await markAllRemotePaymentsPaid(groupId, monthNumber, {
          paymentMode: input.mode,
          paidDate: input.paidDate ?? todayIso()
        });
        nextGroup = mapRemoteGroup(await fetchGroupSnapshotById(groupId));
      } else {
        nextGroup = recomputeMemberWins({
          ...group,
          months: group.months.map((entry) => {
            if (entry.monthNumber !== monthNumber) return entry;
            return {
              ...entry,
              payments: entry.payments.map((payment) =>
                recomputePayment({
                  ...payment,
                  subPayments: payment.subPayments.map((subPayment) => ({
                    ...subPayment,
                    paid: true,
                    paidDate: input.paidDate ?? subPayment.paidDate ?? todayIso(),
                    paymentMode: input.mode ?? subPayment.paymentMode ?? "offline"
                  }))
                })
              )
            };
          })
        });
      }

      writePersistedState(get, set, { groups: replaceGroup(get().groups, normalizeGroups([nextGroup])[0]) });
      return { ok: true, message: "All contributors marked paid." };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Failed to mark all payments paid." };
    }
  },
  selectWinner: async (groupId, monthNumber, memberId) => {
    const group = get().groups.find((entry) => entry.id === groupId);
    if (!group) return { ok: false, message: "Group not found." };
    const month = group.months.find((entry) => entry.monthNumber === monthNumber);
    if (!month) return { ok: false, message: "Month not found." };

    try {
      let nextGroup: BhishiGroup;

      if (isSupabaseConfigured && supabase && get().session) {
        await selectRemoteWinner(groupId, monthNumber, memberId);
        nextGroup = mapRemoteGroup(await fetchGroupSnapshotById(groupId));
      } else {
        nextGroup = recomputeMemberWins({
          ...group,
          months: group.months.map((entry) =>
            entry.monthNumber === monthNumber ? { ...entry, winnerId: memberId, isLocked: false, lockedAt: undefined } : entry
          )
        });
      }

      writePersistedState(get, set, { groups: replaceGroup(get().groups, normalizeGroups([nextGroup])[0]) });
      return { ok: true, message: "Winner updated." };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Failed to update winner." };
    }
  },
  lockMonth: async () => ({ ok: true, message: "Locking is removed from this workflow." }),
  deleteGroup: async (groupId) => {
    const currentGroups = get().groups;
    const existingGroup = currentGroups.find((group) => group.id === groupId);

    if (!existingGroup) {
      return { ok: false, message: "Group not found." };
    }

    const nextGroups = currentGroups.filter((group) => group.id !== groupId);
    writePersistedState(get, set, { groups: nextGroups });

    try {
      if (isSupabaseConfigured && supabase && get().session) {
        await deleteRemoteGroup(groupId);
      }

      return { ok: true, message: "Group deleted successfully." };
    } catch (error) {
      writePersistedState(get, set, { groups: currentGroups });
      return { ok: false, message: error instanceof Error ? error.message : "Failed to delete group." };
    }
  },
  dismissInstallBanner: () => {
    writePersistedState(get, set, { installBannerDismissed: true });
  }
}));
