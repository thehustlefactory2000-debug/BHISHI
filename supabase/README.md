# Supabase Setup

1. Create a Supabase project.
2. In the SQL editor, run `supabase/bhishi_admin_schema.sql`.
3. Then run `supabase/2026-03-26_signup_and_profile_sync.sql`.
4. Then run `supabase/2026-03-26_update_group.sql`.
5. Copy `.env.example` to `.env` and fill `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
6. Enable Email auth in Supabase Auth.
7. Use `/signup` in the app to create the first admin account when Supabase env vars are configured.
8. Turn on realtime for `bhishi_groups`, `bhishi_members`, `bhishi_months`, and `bhishi_payments` if your project requires manual publication setup.

Connection troubleshooting:
- If the app says Supabase is not configured, check `.env` and restart the Vite dev server.
- If the app says a SQL function is missing, one of the SQL files above was not applied.
- If the app says the schema is incomplete or stale, rerun the schema SQL and refresh the Supabase schema cache.
- If the app says access is denied, confirm you are signed in and the RLS policies from `bhishi_admin_schema.sql` are installed.
- If realtime fails, verify the tables are part of the `supabase_realtime` publication.


