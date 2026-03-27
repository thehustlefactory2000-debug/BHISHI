interface ErrorLike {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
  status?: number;
}

const hasText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && hasText((error as ErrorLike).message)) {
    return (error as ErrorLike).message!;
  }
  return "";
};

const getErrorMeta = (error: unknown): ErrorLike => {
  if (error && typeof error === "object") return error as ErrorLike;
  return {};
};

export function formatSupabaseError(error: unknown, fallback: string) {
  const meta = getErrorMeta(error);
  const message = getErrorMessage(error);
  const normalized = message.toLowerCase();
  const details = hasText(meta.details) ? meta.details.toLowerCase() : "";
  const hint = hasText(meta.hint) ? meta.hint.toLowerCase() : "";
  const code = hasText(meta.code) ? meta.code.toUpperCase() : "";

  if (!message) return fallback;

  if (normalized.includes("supabase is not configured")) {
    return "Supabase env vars are missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env and restart Vite.";
  }

  if (
    normalized.includes("failed to fetch") ||
    normalized.includes("networkerror") ||
    normalized.includes("load failed") ||
    normalized.includes("fetch failed")
  ) {
    return "The app could not reach Supabase. Check the project URL, internet access, and whether the Supabase project is available.";
  }

  if (
    code === "PGRST202" ||
    normalized.includes("could not find the function") ||
    details.includes("schema cache") ||
    hint.includes("schema cache")
  ) {
    return "A required Supabase SQL function is missing. Run all SQL files in the supabase folder, including the latest contributor-payment migration.";
  }

  if (
    normalized.includes("relation") ||
    normalized.includes("does not exist") ||
    normalized.includes("schema cache")
  ) {
    return "The Supabase schema is incomplete or stale. Run the SQL setup files again and refresh the database schema cache.";
  }

  if (
    normalized.includes("permission denied") ||
    normalized.includes("row-level security") ||
    normalized.includes("violates row-level security")
  ) {
    return "Supabase denied this request. Check that you are signed in as the correct admin and that the RLS policies from the schema file are installed.";
  }

  if (
    normalized.includes("realtime") ||
    normalized.includes("websocket") ||
    normalized.includes("channel_error") ||
    normalized.includes("timed out")
  ) {
    return "Supabase realtime is unavailable. The app will keep working with manual refresh or polling, but check the Realtime publication and project status.";
  }

  if (normalized.includes("duplicate member names")) {
    return "Member names must be unique within the group.";
  }

  if (normalized.includes("at least one contributor")) {
    return "Each member needs at least one contributor.";
  }

  if (normalized.includes("member needs a 10-digit phone")) {
    return "Every member needs a 10-digit phone number.";
  }

  if (
    normalized.includes("10-digit phone") ||
    normalized.includes("phone number") ||
    normalized.includes("phone ~")
  ) {
    return "Every contributor phone number must contain exactly 10 digits.";
  }

  if (
    normalized.includes("jwt") ||
    normalized.includes("auth") ||
    normalized.includes("invalid login credentials") ||
    normalized.includes("email not confirmed")
  ) {
    return message;
  }

  return message;
}


