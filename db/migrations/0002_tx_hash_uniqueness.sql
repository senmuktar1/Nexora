-- Global, atomic uniqueness of Stellar transaction hashes recorded by the RWA workflow.
-- A hash is reserved here in the SAME database transaction that records the step, so
-- concurrent attempts to reuse one hash (any step, any application or subscription)
-- cannot both succeed: the primary key blocks the second until the first commits or
-- rolls back.

create table if not exists rwa_recorded_transactions (
  tx_hash text primary key check (tx_hash ~ '^[0-9a-f]{64}$'),
  step text not null check (step in ('issuance','authorization','delivery')),
  application_id uuid not null references rwa_applications(id) on delete cascade,
  subscription_id uuid references rwa_subscriptions(id) on delete cascade,
  recorded_at timestamptz not null default now(),
  check ((step = 'issuance') = (subscription_id is null))
);
alter table rwa_recorded_transactions enable row level security;

-- Backfill hashes recorded before this migration (first occurrence wins).
insert into rwa_recorded_transactions (tx_hash, step, application_id)
  select issued_tx_hash, 'issuance', application_id from rwa_token_configs where issued_tx_hash is not null
  on conflict (tx_hash) do nothing;
insert into rwa_recorded_transactions (tx_hash, step, application_id, subscription_id)
  select authorize_tx_hash, 'authorization', application_id, id from rwa_subscriptions where authorize_tx_hash is not null
  on conflict (tx_hash) do nothing;
insert into rwa_recorded_transactions (tx_hash, step, application_id, subscription_id)
  select delivery_tx_hash, 'delivery', application_id, id from rwa_subscriptions where delivery_tx_hash is not null
  on conflict (tx_hash) do nothing;

-- Defence in depth on the columns themselves.
create unique index if not exists rwa_token_configs_issued_tx_unique on rwa_token_configs (issued_tx_hash) where issued_tx_hash is not null;
create unique index if not exists rwa_subscriptions_authorize_tx_unique on rwa_subscriptions (authorize_tx_hash) where authorize_tx_hash is not null;
create unique index if not exists rwa_subscriptions_delivery_tx_unique on rwa_subscriptions (delivery_tx_hash) where delivery_tx_hash is not null;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on rwa_recorded_transactions from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on rwa_recorded_transactions from authenticated'; end if;
end $$;
