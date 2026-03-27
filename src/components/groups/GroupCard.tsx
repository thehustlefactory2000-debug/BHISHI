import { ArrowRight, CalendarDays, IndianRupee, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { BhishiGroup } from "../../types";
import { formatCurrency, formatDate, payoutDayLabel } from "../../utils/format";
import { getGroupProgress } from "../../utils/helpers";

export function GroupCard({ group }: { group: BhishiGroup }) {
  const { t } = useTranslation();
  const progress = getGroupProgress(group);
  const selectedWinners = group.months.filter((month) => month.winnerId).length;

  return (
    <Link
      to={`/groups/${group.id}`}
      className="card block overflow-hidden p-4 transition hover:-translate-y-0.5 hover:border-primary/40 active:scale-[0.98] sm:p-5"
    >
      <div className="flex flex-col gap-3 sm:gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] sm:text-[11px] uppercase tracking-[0.25em] text-subtle">
              {t("groupCardLabel")}
            </p>
            <h3 className="mt-1 sm:mt-2 break-words text-base font-semibold leading-tight sm:text-xl">
              {group.name}
            </h3>
            <p className="mt-1 sm:mt-2 text-xs sm:text-sm text-subtle">
              {t("startedOn", { date: formatDate(group.startDate) })}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2 sm:px-3 py-1 text-xs font-semibold ${
              group.isCompleted
                ? "bg-success/15 text-success"
                : "bg-primary/15 text-primary"
            }`}
          >
            {group.isCompleted ? t("statusCompleted") : t("statusActive")}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:gap-3 text-sm">
          <div className="soft-panel p-2 sm:p-3">
            <div className="flex items-center gap-1 sm:gap-2 text-subtle">
              <IndianRupee className="size-3.5 sm:size-4" />
              {t("monthly")}
            </div>
            <p className="mt-1 sm:mt-2 text-sm font-semibold text-text sm:text-base">
              {formatCurrency(group.monthlyAmount)}
            </p>
          </div>
          <div className="soft-panel p-2 sm:p-3">
            <div className="flex items-center gap-1 sm:gap-2 text-subtle">
              <Users className="size-3.5 sm:size-4" />
              {t("members")}
            </div>
            <p className="mt-1 sm:mt-2 text-sm font-semibold text-text sm:text-base">
              {group.totalMembers}
            </p>
          </div>
        </div>

        <div>
          <div className="mb-1 sm:mb-2 flex items-center justify-between gap-3 text-xs sm:text-sm text-subtle">
            <span>{t("membersLockedSummary", { locked: selectedWinners, total: group.totalMembers })}</span>
            <span className="shrink-0">{progress}%</span>
          </div>
          <div className="h-1.5 sm:h-2 rounded-full bg-muted">
            <div
              className="h-1.5 sm:h-2 rounded-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 text-xs sm:text-sm text-subtle">
          <div className="min-w-0 flex items-center gap-1 sm:gap-2">
            <CalendarDays className="size-3.5 sm:size-4 shrink-0" />
            <span className="truncate">{t("payoutOn", { day: payoutDayLabel(group.payoutDate) })}</span>
          </div>
          <ArrowRight className="size-3.5 sm:size-4 shrink-0" />
        </div>
      </div>
    </Link>
  );
}


