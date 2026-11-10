-- Supabase security advisor fixes. Both functions only run as triggers, never as API calls.
alter function set_updated_at() set search_path = public;
revoke execute on function flag_missed_question() from public, anon, authenticated;
