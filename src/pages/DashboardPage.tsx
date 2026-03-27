import { Download, Smartphone, TrendingUp, CheckCircle, Circle, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { GroupCard } from "../components/groups/GroupCard";
import { AppShell } from "../components/layout/AppShell";
import { isSupabaseConfigured } from "../lib/supabase";
import { fetchGroupSnapshots, mapRemoteGroup, subscribeToAdminRealtime } from "../services/supabaseGroups";
import { useAppStore } from "../store/useAppStore";

declare global {
  interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  }
}

export function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const groupsRaw = useAppStore((state) => state.groups);
  const visitCount = useAppStore((state) => state.visitCount);
  const installBannerDismissed = useAppStore((state) => state.installBannerDismissed);
  const dismissInstallBanner = useAppStore((state) => state.dismissInstallBanner);
  const session = useAppStore((state) => state.session);
  const replaceGroups = useAppStore((state) => state.replaceGroups);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [remoteError, setRemoteError] = useState("");

  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !session?.adminId) return;

    const load = async () => {
      try {
        const rows = await fetchGroupSnapshots();
        replaceGroups(rows.map(mapRemoteGroup));
        setRemoteError("");
      } catch (error) {
        setRemoteError(error instanceof Error ? error.message : t("remoteLoadFailed"));
      }
    };

    void load();
    const unsubscribe = subscribeToAdminRealtime(session.adminId, () => { void load(); });
    const pollId = window.setInterval(() => {
      void load();
    }, 30000);

    return () => {
      window.clearInterval(pollId);
      unsubscribe();
    };
  }, [replaceGroups, session?.adminId, t]);

  const groups = [...groupsRaw].sort((a, b) => {
    if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
    return new Date(b.startDate).getTime() - new Date(a.startDate).getTime();
  });
  const active = groups.filter((g) => !g.isCompleted).length;
  const completed = groups.filter((g) => g.isCompleted).length;

  return (
    <AppShell
      title={t("myGroups")}
      subtitle={t("tagline")}
      stickyHeader={false}
      action={
        <button
          className="btn-secondary hidden items-center gap-1.5 sm:inline-flex"
          onClick={() => navigate("/groups/create")}
        >
          <Plus size={15} />
          {t("createGroup")}
        </button>
      }
    >
      {/* Remote error */}
      {remoteError && (
        <p className="mb-4 rounded-xl border border-danger/20 bg-danger/8 px-4 py-3 text-sm text-danger">
          {remoteError}
        </p>
      )}

      {/* Install banner */}
      {visitCount >= 3 && !installBannerDismissed && (
        <section className="mb-4 overflow-hidden rounded-2xl border border-primary/20 bg-primary/6">
          {/* thin top bar */}
          <div className="h-0.5 w-full bg-gradient-to-r from-primary via-primary/50 to-transparent" />
          <div className="flex flex-col gap-4 p-4 sm:p-5 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3.5">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
                <Smartphone size={19} />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-text">{t("installTitle")}</h2>
                <p className="mt-0.5 max-w-lg text-xs leading-relaxed text-subtle">
                  {t("installSubtitle")}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                className="btn-secondary py-2 text-xs"
                onClick={dismissInstallBanner}
              >
                {t("later")}
              </button>
              <button
                className="btn-primary inline-flex items-center gap-1.5 py-2 text-xs"
                disabled={!installEvent}
                onClick={async () => {
                  if (!installEvent) return;
                  await installEvent.prompt();
                  dismissInstallBanner();
                  setInstallEvent(null);
                }}
              >
                <Download size={13} />
                {t("addToHomeScreen")}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Stat cards */}
      <section className="grid grid-cols-3 gap-2 sm:gap-3">
        {/* Total */}
        <div className="card flex flex-col justify-between p-3 sm:p-5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[10px] uppercase tracking-wider text-subtle sm:text-xs">{t("totalGroups")}</p>
            <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted sm:size-8">
              <TrendingUp size={13} className="text-subtle sm:size-4" />
            </div>
          </div>
          <div>
            <p className="mt-2 text-2xl font-semibold tabular-nums sm:text-3xl">{groups.length}</p>
            <p className="mt-0.5 hidden text-xs leading-relaxed text-subtle sm:block">{t("allCirclesOnAccount")}</p>
          </div>
        </div>

        {/* Active */}
        <div className="card flex flex-col justify-between p-3 sm:p-5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[10px] uppercase tracking-wider text-subtle sm:text-xs">{t("activeGroups")}</p>
            <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 sm:size-8">
              <Circle size={13} className="text-primary sm:size-4" />
            </div>
          </div>
          <div>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-primary sm:text-3xl">{active}</p>
            <p className="mt-0.5 hidden text-xs leading-relaxed text-subtle sm:block">{t("stillMovingThroughWinnerSelection")}</p>
          </div>
        </div>

        {/* Completed */}
        <div className="card flex flex-col justify-between p-3 sm:p-5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[10px] uppercase tracking-wider text-subtle sm:text-xs">{t("completedGroups")}</p>
            <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-success/10 sm:size-8">
              <CheckCircle size={13} className="text-success sm:size-4" />
            </div>
          </div>
          <div>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-success sm:text-3xl">{completed}</p>
            <p className="mt-0.5 hidden text-xs leading-relaxed text-subtle sm:block">{t("everyMonthLocked")}</p>
          </div>
        </div>
      </section>

      {/* Groups */}
      <section className="mt-4">
        {groups.length === 0 ? (
          /* Empty state */
          <div className="card flex min-h-[400px] flex-col items-center justify-center p-6 text-center sm:min-h-[440px] sm:p-10">
            {/* Icon */}
            <div className="relative">
              <div className="flex size-20 items-center justify-center rounded-3xl bg-primary/10 text-primary sm:size-24">
                <Smartphone size={32} className="sm:size-10" />
              </div>
              {/* orbiting dot */}
              <span className="absolute -right-1 -top-1 size-4 rounded-full border-2 border-surface bg-primary/30" />
            </div>

            <h2 className="mt-6 text-2xl font-semibold sm:text-3xl">{t("createFirstGroup")}</h2>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-subtle sm:max-w-md">
              {t("noGroupsMessage")}
            </p>

            <button
              className="btn-primary mt-6 inline-flex w-full items-center justify-center gap-2 sm:w-auto"
              onClick={() => navigate("/groups/create")}
            >
              <Plus size={15} />
              {t("createGroup")}
            </button>
          </div>
        ) : (
          <>
            {/* Section header */}
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-text">
                  {active > 0 ? t("activeSummary", { count: active }) : t("allGroups")}
                  {completed > 0 && ` Â· ${t("completedSummary", { count: completed })}`}
                </h2>
              </div>
              {/* Mobile create button */}
              <button
                className="btn-secondary inline-flex items-center gap-1.5 py-1.5 text-xs sm:hidden"
                onClick={() => navigate("/groups/create")}
              >
                <Plus size={13} />
                {t("newGroup")}
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
              {groups.map((group) => (
                <GroupCard key={group.id} group={group} />
              ))}
            </div>
          </>
        )}
      </section>
    </AppShell>
  );
}

