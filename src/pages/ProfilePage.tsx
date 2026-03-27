import { FormEvent, useMemo, useState } from "react";
import { Globe, KeyRound, LogOut, Monitor, Moon, Palette, Sun, Trash2, User } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { isSupabaseConfigured } from "../lib/supabase";
import { deleteRemoteAdmin, signOutAdmin } from "../services/supabaseAuth";
import { useAppStore } from "../store/useAppStore";

export function ProfilePage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const admin = useAppStore((state) => state.admin)!;
  const logout = useAppStore((state) => state.logout);
  const updateTheme = useAppStore((state) => state.updateTheme);
  const updateLanguage = useAppStore((state) => state.updateLanguage);
  const changePassword = useAppStore((state) => state.changePassword);
  const deleteAccount = useAppStore((state) => state.deleteAccount);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [deleteValue, setDeleteValue] = useState("");
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);

    if (newPassword.length < 8) return setMessage({ text: t("passwordMin"), ok: false });
    if (newPassword !== confirmPassword) return setMessage({ text: t("passwordMismatch"), ok: false });

    setSavingPassword(true);
    const success = await changePassword(currentPassword, newPassword);
    setSavingPassword(false);

    if (!success) return setMessage({ text: t("passwordIncorrect"), ok: false });

    setMessage({ text: t("passwordUpdated"), ok: true });
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  };

  const handleTheme = async (theme: typeof admin.theme) => {
    await updateTheme(theme);
  };

  const handleLanguage = async (lang: typeof admin.language) => {
    await updateLanguage(lang);
  };

  const handleLogout = async () => {
    if (isSupabaseConfigured) await signOutAdmin();
    logout();
    navigate("/login");
  };

  const canDelete = useMemo(() => deleteValue === "DELETE", [deleteValue]);

  const handleDelete = async () => {
    if (!canDelete) return;
    try {
      if (isSupabaseConfigured) await deleteRemoteAdmin();
      await deleteAccount();
      navigate("/setup", { replace: true });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : t("failedToDeleteAccount"), ok: false });
    }
  };

  const themes = [
    { key: "light" as const, Icon: Sun, label: t("themeLight") },
    { key: "dark" as const, Icon: Moon, label: t("themeDark") },
    { key: "system" as const, Icon: Monitor, label: t("themeSystem") }
  ];

  return (
    <AppShell title={t("profile")} subtitle={t("profileSubtitle")} backTo="/dashboard">
      <div className="mx-auto max-w-xl space-y-3">
        <div className="card flex items-center gap-4 p-4 sm:p-5">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <User size={22} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-text">{admin.email}</p>
            <p className="text-xs text-subtle">{t("administrator")}</p>
          </div>
          <button
            className="btn-secondary ml-auto shrink-0 inline-flex items-center gap-1.5 py-2 text-xs"
            type="button"
            onClick={handleLogout}
          >
            <LogOut size={13} />
            {t("logout")}
          </button>
        </div>

        <section className="card p-4 sm:p-5">
          <div className="mb-4 flex items-center gap-2">
            <Palette size={14} className="text-subtle" />
            <h2 className="text-xs font-semibold uppercase tracking-widest text-subtle">{t("appearance")}</h2>
          </div>

          <div className="mb-4">
            <label className="label mb-2 block text-xs">{t("theme")}</label>
            <div className="grid grid-cols-3 gap-2">
              {themes.map(({ key, Icon, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => void handleTheme(key)}
                  className={`flex flex-col items-center gap-2 rounded-2xl border py-4 text-xs font-medium transition-all active:scale-95 ${
                    admin.theme === key
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-muted text-subtle hover:border-text/20 hover:text-text"
                  }`}
                >
                  <Icon size={20} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center gap-1.5">
              <Globe size={13} className="text-subtle" />
              <label className="label text-xs">{t("language")}</label>
            </div>
            <select
              className="input"
              value={admin.language}
              onChange={(e) => void handleLanguage(e.target.value as typeof admin.language)}
            >
              <option value="en">{t("english")}</option>
              <option value="mr">{t("marathi")}</option>
              <option value="hi">{t("hindi")}</option>
            </select>
          </div>
        </section>

        <section className="card p-4 sm:p-5">
          <div className="mb-4 flex items-center gap-2">
            <KeyRound size={14} className="text-subtle" />
            <h2 className="text-xs font-semibold uppercase tracking-widest text-subtle">{t("account")}</h2>
          </div>

          <form className="space-y-3" onSubmit={submitPassword}>
            <input
              className="input"
              type="password"
              placeholder={t("currentPassword")}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
            <input
              className="input"
              type="password"
              placeholder={t("newPassword")}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
            <input
              className="input"
              type="password"
              placeholder={t("confirmNewPassword")}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />

            {message && (
              <p className={`rounded-2xl px-4 py-3 text-sm ${message.ok ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>
                {message.text}
              </p>
            )}

            <button className="btn-primary w-full active:scale-[0.98]" disabled={savingPassword} type="submit">
              {t("updatePassword")}
            </button>
          </form>
        </section>

        <section className="card border-danger/25 p-4 sm:p-5">
          <div className="mb-3 flex items-center gap-2">
            <Trash2 size={14} className="text-danger" />
            <h2 className="text-xs font-semibold uppercase tracking-widest text-danger">{t("dangerZone")}</h2>
          </div>
          <p className="mb-4 text-sm text-subtle">
            {t("dangerDescription")} <strong className="font-semibold text-text">DELETE</strong> {t("dangerDescriptionEnd")}
          </p>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder={t("deleteAccountPlaceholder")}
              value={deleteValue}
              onChange={(e) => setDeleteValue(e.target.value)}
              autoComplete="off"
            />
            <button
              className="btn-danger shrink-0 active:scale-[0.98]"
              disabled={!canDelete}
              onClick={handleDelete}
              type="button"
            >
              {t("deleteAccount")}
            </button>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
