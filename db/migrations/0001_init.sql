-- NEXORA backend schema (PostgreSQL 15+ / Supabase).
-- All access is server-side via DATABASE_URL. RLS is enabled on every table with
-- no policies, so Supabase's public API roles (anon/authenticated) are denied.

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  -- 'public' = applicants/investors on the main site; 'admin' = staff on the admin host.
  realm text not null check (realm in ('public','admin')),
  email text not null check (email = lower(email) and position('@' in email) > 1),
  password_hash text not null,
  role text not null default 'user' check (role in ('user','super_admin','reviewer','compliance')),
  status text not null default 'pending' check (status in ('pending','active','suspended')),
  email_verified_at timestamptz,
  mfa_secret_enc text,
  mfa_enabled boolean not null default false,
  mfa_last_step bigint,
  recovery_codes jsonb not null default '[]'::jsonb,
  stellar_address text check (stellar_address is null or stellar_address ~ '^G[A-Z2-7]{55}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz,
  unique (realm, email),
  -- Public accounts are always plain users; admin roles exist only in the admin realm.
  check ((realm = 'public' and role = 'user') or (realm = 'admin' and role <> 'user'))
);
-- At most one Super Admin can ever exist.
create unique index if not exists one_super_admin on app_users ((role)) where role = 'super_admin';

create table if not exists sessions (
  token_hash text primary key,
  user_id uuid not null references app_users(id) on delete cascade,
  kind text not null check (kind in ('public','admin')),
  mfa_passed boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  idle_expires_at timestamptz not null,
  user_agent text
);
create index if not exists sessions_user on sessions(user_id);

create table if not exists email_tokens (
  token_hash text primary key,
  user_id uuid not null references app_users(id) on delete cascade,
  purpose text not null check (purpose in ('verify')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create table if not exists login_attempts (
  key text primary key,
  failures int not null default 0,
  window_start timestamptz not null default now(),
  locked_until timestamptz
);

create table if not exists platform_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references app_users(id)
);

-- One-time admin bootstrap marker (a second insert fails).
create table if not exists admin_bootstrap (
  id boolean primary key default true check (id),
  completed_at timestamptz not null default now(),
  admin_user_id uuid not null references app_users(id),
  admin_email text not null
);

create table if not exists admin_audit_log (
  id bigserial primary key,
  actor_user_id uuid references app_users(id),
  actor_email text,
  action text not null,
  target_type text,
  target_id text,
  previous_status text,
  new_status text,
  reason text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_created on admin_audit_log(created_at desc);

create table if not exists rwa_applications (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  owner_user_id uuid not null references app_users(id),
  status text not null default 'draft' check (status in ('draft','submitted','under_review','info_requested','approved','rejected','suspended')),
  category text not null check (category in ('real_estate','gold_commodities','agriculture','private_credit','government_securities','money_market_funds','renewable_energy','other')),
  asset_name text not null,
  description text not null default '',
  country text not null default '',
  jurisdiction text not null default '',
  issuer_legal_name text not null default '',
  issuer_registration text not null default '',
  custodian text not null default '',
  valuation_amount numeric(20,2),
  valuation_currency text,
  valuation_date date,
  insurance text not null default '',
  legal_structure text not null default '',
  redemption_conditions text not null default '',
  investor_eligibility text not null default '',
  transfer_restrictions text not null default '',
  additional_info text not null default '',
  issuer_stellar_address text check (issuer_stellar_address is null or issuer_stellar_address ~ '^G[A-Z2-7]{55}$'),
  info_request text,
  decision_reason text,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  decided_at timestamptz
);
create index if not exists rwa_app_owner on rwa_applications(owner_user_id);
create index if not exists rwa_app_status on rwa_applications(status);

create table if not exists rwa_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references rwa_applications(id) on delete cascade,
  kind text not null check (kind in ('ownership','valuation','offering','registration','insurance','custody','legal_opinion','inspection','report','other')),
  filename text not null,
  mime text not null,
  size_bytes int not null check (size_bytes > 0),
  sha256 text not null,
  iv bytea not null,
  ciphertext bytea not null,
  uploaded_by uuid not null references app_users(id),
  public_with_offering boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists rwa_docs_app on rwa_documents(application_id);

create table if not exists rwa_findings (
  id bigserial primary key,
  application_id uuid not null references rwa_applications(id) on delete cascade,
  author_user_id uuid not null references app_users(id),
  kind text not null check (kind in ('finding','note')),
  subject text not null default '',
  evidence_status text check (evidence_status in ('declared','verified','not_verified')),
  document_id uuid references rwa_documents(id),
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists rwa_status_history (
  id bigserial primary key,
  application_id uuid not null references rwa_applications(id) on delete cascade,
  actor_user_id uuid references app_users(id),
  from_status text,
  to_status text not null,
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists rwa_token_configs (
  application_id uuid primary key references rwa_applications(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','submitted','authorized','issued','revoked')),
  token_code text not null default '',
  total_supply numeric(30,7),
  price_amount numeric(20,7),
  price_currency text,
  min_investment numeric(20,7),
  token_rights text not null default '',
  ownership_structure text not null default '',
  distribution_rules text not null default '',
  investor_eligibility text not null default '',
  transfer_restrictions text not null default '',
  redemption_terms text not null default '',
  distributor_address text check (distributor_address is null or distributor_address ~ '^G[A-Z2-7]{55}$'),
  clawback_enabled boolean not null default true,
  legal_clearance jsonb,
  authorized_by uuid references app_users(id),
  authorized_at timestamptz,
  authorization_expires_at timestamptz,
  issued_tx_hash text,
  issuer_address text,
  issued_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists rwa_subscriptions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references rwa_applications(id) on delete cascade,
  investor_user_id uuid not null references app_users(id),
  investor_address text not null check (investor_address ~ '^G[A-Z2-7]{55}$'),
  amount numeric(30,7) not null check (amount > 0),
  eligibility_attested boolean not null check (eligibility_attested),
  status text not null default 'requested' check (status in ('requested','accepted','rejected','authorized','delivered','cancelled')),
  authorize_tx_hash text,
  delivery_tx_hash text,
  decision_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists rwa_subs_app on rwa_subscriptions(application_id);

create table if not exists rwa_asset_events (
  id bigserial primary key,
  application_id uuid not null references rwa_applications(id) on delete cascade,
  kind text not null check (kind in ('valuation_update','custody_update','insurance_record','inspection_report','revenue_report','distribution_record','redemption_request','incident','issuer_report','status_change')),
  source text not null check (source in ('issuer','admin','investor','on_chain')),
  title text not null,
  body text not null default '',
  amount numeric(30,7),
  currency text,
  event_date date,
  document_id uuid references rwa_documents(id),
  tx_hash text,
  public boolean not null default false,
  status text not null default 'recorded' check (status in ('recorded','pending_review','acknowledged','resolved','rejected')),
  author_user_id uuid references app_users(id),
  created_at timestamptz not null default now()
);
create index if not exists rwa_events_app on rwa_asset_events(application_id, created_at desc);

-- Test-only email outbox (written only in explicit local test mode).
create table if not exists email_outbox (
  id bigserial primary key,
  to_email text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now()
);

-- Row-level security: enable everywhere, no policies (deny-by-default for API roles).
do $$
declare t text;
begin
  foreach t in array array['app_users','sessions','email_tokens','login_attempts','platform_settings','admin_bootstrap','admin_audit_log','rwa_applications','rwa_documents','rwa_findings','rwa_status_history','rwa_token_configs','rwa_subscriptions','rwa_asset_events','email_outbox'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
    execute 'revoke all on all sequences in schema public from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema public from authenticated';
    execute 'revoke all on all sequences in schema public from authenticated';
  end if;
end $$;
