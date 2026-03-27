import { useEffect, useState, type ReactElement } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import i18n from "i18next";
import { useAppStore } from "./store/useAppStore";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { CreateGroupPage } from "./pages/CreateGroupPage";
import { GroupDetailPage } from "./pages/GroupDetailPage";
import { ProfilePage } from "./pages/ProfilePage";
import { SetupPage } from "./pages/SetupPage";
import { SignupPage } from "./pages/SignupPage";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import { ensureCurrentAdminProfile, getSupabaseSession } from "./services/supabaseAuth";
import { formatSupabaseError } from "./utils/supabaseErrors";

/**
 * Global flag to track account deletion
 */
let isDeletingAccount = false;

export const setDeletingAccount = (val: boolean) => {
  isDeletingAccount = val;
};

function ProtectedRoute({ children }: { children: ReactElement }) {
  const session = useAppStore((state) => state.session);
  const admin = useAppStore((state) => state.admin);

  // Check session first — it's the live auth signal
  if (!session) return <Navigate to="/login" replace />;
  if (!admin) return <Navigate to={isSupabaseConfigured ? "/login" : "/setup"} replace />;
  return children;
}

export default function App() {
  const boot = useAppStore((state) => state.boot);
  const admin = useAppStore((state) => state.admin);
  const hydrateRemoteAuth = useAppStore((state) => state.hydrateRemoteAuth);
  const clearAuthState = useAppStore((state) => state.clearAuthState);
  const [remoteBootstrapError, setRemoteBootstrapError] = useState("");

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;

    const syncSession = async () => {
      try {
        const { data } = await getSupabaseSession();
        const session = data.session;

        if (!session?.user.email) return;

        const profile = await ensureCurrentAdminProfile();

        hydrateRemoteAuth({
          adminId: session.user.id,
          email: profile.email,
          token: session.access_token,
          language: profile.preferred_language,
          theme: profile.preferred_theme,
        });

        setRemoteBootstrapError("");
      } catch (error) {
        clearAuthState();
        setRemoteBootstrapError(
          formatSupabaseError(error, "Failed to initialize Supabase auth.")
        );
      }
    };

    void syncSession();

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      /**
       * 1. Ignore sign-out caused by account deletion
       */
      if (event === "SIGNED_OUT" && !session) {
        if (isDeletingAccount) return;

        clearAuthState();
        setRemoteBootstrapError("");
        return;
      }

      /**
       * 2. No valid session
       */
      if (!session?.user.email) {
        if (isDeletingAccount) return;

        clearAuthState();
        setRemoteBootstrapError("");
        return;
      }

      /**
       * 3. Valid session → hydrate
       */
      void ensureCurrentAdminProfile()
        .then((profile) => {
          hydrateRemoteAuth({
            adminId: session.user.id,
            email: profile.email,
            token: session.access_token,
            language: profile.preferred_language,
            theme: profile.preferred_theme,
          });

          setRemoteBootstrapError("");
        })
        .catch((error) => {
          clearAuthState();
          setRemoteBootstrapError(
            formatSupabaseError(error, "Failed to initialize Supabase auth.")
          );
        });
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, [clearAuthState, hydrateRemoteAuth]);

  useEffect(() => {
    if (!admin) return;

    void i18n.changeLanguage(admin.language);

    const root = document.documentElement;
    const resolvedTheme =
      admin.theme === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : admin.theme;

    root.classList.toggle("dark", resolvedTheme === "dark");
  }, [admin]);

  return (
    <>
      {remoteBootstrapError && (
        <div className="fixed inset-x-0 top-0 z-[100] border-b border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger backdrop-blur">
          {remoteBootstrapError}
        </div>
      )}

      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />

        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/groups/create"
          element={
            <ProtectedRoute>
              <CreateGroupPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/groups/:id"
          element={
            <ProtectedRoute>
              <GroupDetailPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <ProfilePage />
            </ProtectedRoute>
          }
        />

        <Route
          path="*"
          element={
            <Navigate
              to={
                admin
                  ? "/dashboard"
                  : isSupabaseConfigured
                  ? "/login"
                  : "/setup"
              }
              replace
            />
          }
        />
      </Routes>
    </>
  );
}