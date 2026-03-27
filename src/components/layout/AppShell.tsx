import type { ReactNode } from "react";
import { ArrowLeft, Home, LogOut, Plus, UserCircle2 } from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { isSupabaseConfigured } from "../../lib/supabase";
import { signOutAdmin } from "../../services/supabaseAuth";
import { useAppStore } from "../../store/useAppStore";

interface AppShellProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
  backTo?: string;
  stickyHeader?: boolean;
}

export function AppShell({ title, subtitle, children, action, backTo, stickyHeader = true }: AppShellProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const logout = useAppStore((state) => state.logout);

  return (
    <div className="app-shell min-h-[100dvh] bg-app pb-[calc(5.75rem+env(safe-area-inset-bottom))] text-text sm:pb-24">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-[-10%] top-[-8rem] h-72 w-72 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute bottom-10 right-[-5%] h-72 w-72 rounded-full bg-cyan-400/15 blur-3xl" />
      </div>
      <header className={`app-shell-header z-30 border-b border-border/70 bg-bg/85 backdrop-blur-xl ${stickyHeader ? "sticky top-0" : "relative"}`}>
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-start gap-3 sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3 sm:items-center">
              {backTo ? (
                <button className="icon-btn shrink-0 active:scale-95" onClick={() => navigate(backTo)} aria-label="Back">
                  <ArrowLeft size={20} />
                </button>
              ) : null}
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.3em] text-subtle">Bhishi Admin</p>
                <h1 className="mt-1 truncate text-lg font-semibold sm:text-2xl">{title}</h1>
                {subtitle ? <p className="mt-1 max-w-3xl text-sm leading-5 text-subtle">{subtitle}</p> : null}
              </div>
            </div>
            <div className="hidden items-center gap-2 sm:flex">
              {action}
              <button className="icon-btn active:scale-95" onClick={() => navigate("/profile")} aria-label="Profile">
                <UserCircle2 size={20} />
              </button>
              <button
                className="icon-btn active:scale-95"
                onClick={async () => {
                  if (isSupabaseConfigured) {
                    await signOutAdmin();
                  }
                  logout();
                  navigate("/login");
                }}
                aria-label={t("logout")}
              >
                <LogOut size={20} />
              </button>
            </div>
          </div>
          {action ? <div className="flex w-full sm:hidden">{action}</div> : null}
        </div>
      </header>
      <main className="app-shell-main relative z-10 mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-6">{children}</main>
      <nav className="app-shell-mobile-nav fixed inset-x-0 bottom-0 z-40 flex items-center justify-between border-t border-border/90 bg-surface/95 px-4 pb-[calc(0.8rem+env(safe-area-inset-bottom))] pt-2 shadow-2xl backdrop-blur-xl sm:hidden">
        <NavLink className="mobile-nav" to="/dashboard">
          <Home size={20} />
          <span>{t("dashboard")}</span>
        </NavLink>
        <button className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary text-white shadow-soft active:scale-95" onClick={() => navigate("/groups/create")} aria-label={t("createGroup")}>
          <Plus size={28} />
        </button>
        <NavLink className="mobile-nav" to="/profile">
          <UserCircle2 size={20} />
          <span>{t("profile")}</span>
        </NavLink>
      </nav>
    </div>
  );
}

