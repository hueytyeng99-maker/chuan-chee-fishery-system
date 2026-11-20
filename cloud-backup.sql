-- CHUAN & CHEE FISHERY cloud backup table for Supabase
-- Run this once in Supabase Dashboard > SQL Editor.
create table if not exists public.ccfishery_backup (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.ccfishery_backup enable row level security;

drop policy if exists "Users can view their own fishery backup" on public.ccfishery_backup;
create policy "Users can view their own fishery backup"
  on public.ccfishery_backup for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own fishery backup" on public.ccfishery_backup;
create policy "Users can insert their own fishery backup"
  on public.ccfishery_backup for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own fishery backup" on public.ccfishery_backup;
create policy "Users can update their own fishery backup"
  on public.ccfishery_backup for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
