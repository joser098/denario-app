-- =============================================================
-- Denario v2 — Base: monedas, organizacion, campus, miembros
-- =============================================================
create extension if not exists pgcrypto;

-- ---------- Catalogo de sistema: monedas ----------
create table currencies (
  code      text primary key,
  name      text not null,
  symbol    text not null,
  is_active boolean not null default true
);

create table currency_denominations (
  id            uuid primary key default gen_random_uuid(),
  currency_code text not null references currencies(code) on delete cascade,
  value         numeric(14,2) not null check (value > 0),
  is_active     boolean not null default true,
  unique (currency_code, value)
);

-- ---------- Organizacion ----------
create table organizations (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  slug             text not null unique,
  timezone         text not null default 'America/Argentina/Buenos_Aires',
  default_currency text not null default 'ARS' references currencies(code),
  logo_path        text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table campuses (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  name             text not null,
  slug             text not null,
  default_currency text not null references currencies(code),
  timezone         text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, slug)
);

create type member_role as enum ('owner', 'admin', 'treasurer', 'viewer');

create table organization_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  campus_id       uuid references campuses(id) on delete set null,
  role            member_role not null default 'viewer',
  invited_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index organization_members_user_idx on organization_members (user_id);

create table invitations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  email           text not null,
  role            member_role not null default 'viewer',
  campus_id       uuid references campuses(id) on delete set null,
  token           text not null unique,
  invited_by      uuid references auth.users(id) on delete set null,
  accepted_at     timestamptz,
  expires_at      timestamptz not null default now() + interval '7 days',
  created_at      timestamptz not null default now(),
  -- owner nunca se otorga por invitacion
  constraint invitations_role_not_owner check (role <> 'owner')
);
create index invitations_pending_idx on invitations (organization_id) where accepted_at is null;

-- ---------- Helpers de autorizacion ----------
-- security definer: las policies de organization_members no pueden consultarse
-- a si mismas sin recursion infinita.
create or replace function public.is_org_member(org uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from organization_members m
    where m.organization_id = org and m.user_id = auth.uid()
  );
$fn$;

create or replace function public.org_role(org uuid)
returns member_role language sql stable security definer set search_path = public as $fn$
  select m.role from organization_members m
  where m.organization_id = org and m.user_id = auth.uid();
$fn$;

-- treasurer carga plata; viewer solo mira
create or replace function public.can_write(org uuid)
returns boolean language sql stable as $fn$
  select public.org_role(org) in ('owner', 'admin', 'treasurer');
$fn$;

create or replace function public.can_admin(org uuid)
returns boolean language sql stable as $fn$
  select public.org_role(org) in ('owner', 'admin');
$fn$;

-- ID publico corto para URLs de reunion. Alfabeto sin I/O/0/1 para que se
-- pueda dictar por telefono sin ambiguedad.
create or replace function public.gen_public_id(len int default 6)
returns text language plpgsql volatile as $fn$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result   text := '';
  i        int;
begin
  for i in 1..len loop
    result := result || substr(alphabet, floor(random() * length(alphabet))::int + 1, 1);
  end loop;
  return result;
end;
$fn$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

create trigger organizations_touch before update on organizations
  for each row execute function public.touch_updated_at();
create trigger campuses_touch before update on campuses
  for each row execute function public.touch_updated_at();

-- ---------- RLS ----------
alter table currencies             enable row level security;
alter table currency_denominations enable row level security;
alter table organizations          enable row level security;
alter table campuses               enable row level security;
alter table organization_members   enable row level security;
alter table invitations            enable row level security;

-- Catalogos de sistema: lectura para cualquier usuario autenticado.
create policy currencies_read on currencies
  for select to authenticated using (true);
create policy denominations_read on currency_denominations
  for select to authenticated using (true);

create policy organizations_read on organizations
  for select to authenticated using (public.is_org_member(id));
create policy organizations_update on organizations
  for update to authenticated using (public.can_admin(id)) with check (public.can_admin(id));

create policy campuses_read on campuses
  for select to authenticated using (public.is_org_member(organization_id));
create policy campuses_write on campuses
  for all to authenticated
  using (public.can_admin(organization_id))
  with check (public.can_admin(organization_id));

create policy members_read on organization_members
  for select to authenticated using (public.is_org_member(organization_id));
create policy members_write on organization_members
  for all to authenticated
  using (public.can_admin(organization_id))
  with check (public.can_admin(organization_id));

create policy invitations_admin on invitations
  for all to authenticated
  using (public.can_admin(organization_id))
  with check (public.can_admin(organization_id));
