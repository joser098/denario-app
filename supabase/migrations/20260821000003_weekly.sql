-- =============================================================
-- Denario v2 — Modulo SEMANAL
-- Libro general, de martes a lunes. La plata del domingo se vuelve a
-- cargar aca como ingreso a secas (sin etiqueta de ofrenda). Es una
-- doble carga deliberada: este modulo no lee ni escribe nada del
-- modulo Domingos.
-- =============================================================

-- ---------- Conceptos de ingreso de la semana ----------
-- organization_id null = plantilla del sistema, se clona al crear la org.
create table week_concepts (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid references organizations(id) on delete cascade,
  code               text not null,
  name               text not null,
  allowed_currencies text[] not null default array['ARS'],
  -- "transacciones" necesita registrar tambien cuantos movimientos
  -- componen el monto (ej. USD 100 = 4 transacciones de 25).
  has_movement_count boolean not null default false,
  sort_order         smallint not null default 0,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  constraint week_concepts_currencies_not_empty check (array_length(allowed_currencies, 1) > 0)
);
create unique index week_concepts_org_code on week_concepts (organization_id, code)
  where organization_id is not null;
create unique index week_concepts_template_code on week_concepts (code)
  where organization_id is null;

-- ---------- La semana ----------
create type week_status as enum ('open', 'closed');

create table weeks (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  campus_id       uuid references campuses(id) on delete cascade,
  start_date      date not null,
  end_date        date not null,
  status          week_status not null default 'open',
  notes           text,
  closed_at       timestamptz,
  closed_by       uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- martes a lunes, 7 dias. isodow: lunes=1, martes=2.
  constraint weeks_starts_tuesday check (extract(isodow from start_date) = 2),
  constraint weeks_seven_days check (end_date = start_date + 6)
);
-- Una semana por org+campus. campus_id null (nivel organizacion) es un slot propio.
create unique index weeks_unique_slot on weeks
  (organization_id, coalesce(campus_id, '00000000-0000-0000-0000-000000000000'::uuid), start_date);
create index weeks_org_start_idx on weeks (organization_id, start_date desc);

create trigger weeks_touch before update on weeks
  for each row execute function public.touch_updated_at();

create table week_entries (
  id             uuid primary key default gen_random_uuid(),
  week_id        uuid not null references weeks(id) on delete cascade,
  concept_id     uuid not null references week_concepts(id) on delete restrict,
  currency_code  text not null references currencies(code),
  amount         numeric(16,2) not null check (amount >= 0),
  movement_count integer check (movement_count is null or movement_count >= 0),
  entry_date     date,
  description    text,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index week_entries_week_idx on week_entries (week_id);

create trigger week_entries_touch before update on week_entries
  for each row execute function public.touch_updated_at();

-- La moneda cargada tiene que estar habilitada para ese concepto, y la fecha
-- (si se informa) tiene que caer dentro de la semana.
create or replace function public.validate_week_entry()
returns trigger language plpgsql as $fn$
declare
  allowed text[];
  w_start date;
  w_end   date;
  w_status week_status;
begin
  select c.allowed_currencies into allowed from week_concepts c where c.id = new.concept_id;
  if not (new.currency_code = any (allowed)) then
    raise exception 'El concepto no admite la moneda %', new.currency_code;
  end if;

  select w.start_date, w.end_date, w.status into w_start, w_end, w_status
    from weeks w where w.id = new.week_id;
  if w_status = 'closed' then
    raise exception 'La semana esta cerrada.';
  end if;
  if new.entry_date is not null and (new.entry_date < w_start or new.entry_date > w_end) then
    raise exception 'La fecha % cae fuera de la semana % a %', new.entry_date, w_start, w_end;
  end if;
  return new;
end;
$fn$;

create trigger week_entries_validate before insert or update on week_entries
  for each row execute function public.validate_week_entry();

-- ---------- RLS ----------
alter table week_concepts enable row level security;
alter table weeks         enable row level security;
alter table week_entries  enable row level security;

-- Las plantillas del sistema (organization_id null) las lee cualquier autenticado.
create policy week_concepts_read on week_concepts
  for select to authenticated
  using (organization_id is null or public.is_org_member(organization_id));
create policy week_concepts_write on week_concepts
  for all to authenticated
  using (organization_id is not null and public.can_admin(organization_id))
  with check (organization_id is not null and public.can_admin(organization_id));

create policy weeks_read on weeks
  for select to authenticated using (public.is_org_member(organization_id));
create policy weeks_write on weeks
  for all to authenticated
  using (public.can_write(organization_id)) with check (public.can_write(organization_id));

create or replace function public.week_org(w_id uuid)
returns uuid language sql stable security definer set search_path = public as $fn$
  select w.organization_id from weeks w where w.id = w_id;
$fn$;

create policy week_entries_read on week_entries
  for select to authenticated using (public.is_org_member(public.week_org(week_id)));
create policy week_entries_write on week_entries
  for all to authenticated
  using (public.can_write(public.week_org(week_id)))
  with check (public.can_write(public.week_org(week_id)));
