import { supabase } from "../lib/supabase";
import { RemoteAdminProfile } from "../types";
import { formatSupabaseError } from "../utils/supabaseErrors";

export async function signInAdmin(email: string, password: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signUpAdmin(email: string, password: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        role: "admin"
      }
    }
  });
}

export async function signOutAdmin() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase.auth.signOut();
}

export async function getSupabaseSession() {
  if (!supabase) return { data: { session: null }, error: null };
  return supabase.auth.getSession();
}

export async function ensureCurrentAdminProfile() {
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("ensure_current_admin_profile");
  if (error) throw new Error(formatSupabaseError(error, "Failed to load the admin profile from Supabase."));
  return data as RemoteAdminProfile;
}

export async function updateRemoteAdminPreferences(input: {
  language?: RemoteAdminProfile["preferred_language"];
  theme?: RemoteAdminProfile["preferred_theme"];
}) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError) throw new Error(formatSupabaseError(userError, "Failed to load the authenticated admin."));
  if (!user) throw new Error("Authentication required.");

  const updatePayload: Partial<RemoteAdminProfile> = {};
  if (input.language !== undefined) updatePayload.preferred_language = input.language;
  if (input.theme !== undefined) updatePayload.preferred_theme = input.theme;

  const { data, error } = await supabase
    .from("admin_profiles")
    .update(updatePayload)
    .eq("id", user.id)
    .select("id, email, preferred_language, preferred_theme, created_at, updated_at")
    .single();

  if (error) throw new Error(formatSupabaseError(error, "Failed to update the admin profile in Supabase."));
  return data as RemoteAdminProfile;
}

export async function changeRemotePassword(currentPassword: string, nextPassword: string) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError) throw new Error(formatSupabaseError(userError, "Failed to load the authenticated admin."));
  if (!user?.email) throw new Error("Authentication required.");

  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword
  });

  if (verifyError) {
    throw new Error(formatSupabaseError(verifyError, "Current password is incorrect."));
  }

  const { error: updateError } = await supabase.auth.updateUser({ password: nextPassword });
  if (updateError) throw new Error(formatSupabaseError(updateError, "Failed to update the password in Supabase."));
}

export async function sendPasswordReset(email: string) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const redirectTo = `${window.location.origin}/login`;
  const result = await supabase.auth.resetPasswordForEmail(email, { redirectTo });

  if (result.error) {
    throw new Error(formatSupabaseError(result.error, "Failed to send the reset email."));
  }

  return result;
}

export async function deleteRemoteAdmin() {
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data: { session }, error } = await supabase.auth.refreshSession();
  if (error || !session) throw new Error("Authentication required.");

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-admin-account`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
        "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
    }
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to delete account. Status: ${res.status}`);
  }

  // Stop auto-refresh from trying to renew a deleted session.
  // Do not call the logout endpoint here: once the auth user is deleted, Supabase can return 403 for logout,
  // which only creates console noise even though the deletion already succeeded.
  supabase.auth.stopAutoRefresh();
}