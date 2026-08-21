-- =============================================================
-- Denario v2 — Modulo DOMINGOS (ofrendas)
-- Libro de detalle. Independiente del modulo Semanal: nada de lo
-- que se registre aca genera filas alla, ni al reves.
-- =============================================================

-- ---------- Plantilla de reuniones del campus ----------
-- Hoy son 4 (10:30, 12:30, 17:30, 20:00) pero cambian horario y cantidad;
-- por eso es una tabla editable y no una constante.
create table meeting_templates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  campus_id       uuid not null references campuses(id) on delete cascade,
  label           text not null,
  start_time      time not null,
  sort_order      smallint not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);
create index meeting_templates_campus_idx on meeting_templates (campus_id) where is_active;

-- ---------- El domingo ----------
create type sunday_status as enum ('draft', 'closed');

create table sundays (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  campus_id       uuid not null references campuses(id) on delete cascade,
  service_date    date not null,
  status          sunday_status not null default 'draft',
  notes           text,
  closed_at       timestamptz,
  closed_by       uuid references auth.users(id) on delete set null,
  acta_pdf_path   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (campus_id, service_date)
);
create index sundays_org_date_idx on sundays (organization_id, service_date desc);

create trigger sundays_touch before update on sundays
  for each row execute function public.touch_updated_at();

-- ---------- Subeventos (reuniones) ----------
create type meeting_status as enum ('open', 'locked');

create table sunday_meetings (
  id         uuid primary key default gen_random_uuid(),
  sunday_id  uuid not null references sundays(id) on delete cascade,
  public_id  text not null unique,
  label      text not null,
  start_time time not null,
  sort_order smallint not null default 0,
  status     meeting_status not null default 'open',
  created_at timestamptz not null default now()
);
create index sunday_meetings_sunday_idx on sunday_meetings (sunday_id);

-- Reintenta hasta encontrar un ID libre. Se define despues de la tabla
-- porque la consulta de colision la referencia.
create or replace function public.new_meeting_public_id()
returns text language plpgsql volatile as $fn$
declare candidate text;
begin
  loop
    candidate := public.gen_public_id(6);
    exit when not exists (select 1 from sunday_meetings where public_id = candidate);
  end loop;
  return candidate;
end;
$fn$;

alter table sunday_meetings alter column public_id set default public.new_meeting_public_id();

-- ---------- Acta de conteo de ofrendas ----------
create type offering_count_status as enum ('draft', 'finalized', 'voided');

create table offering_counts (
  id              uuid primary key default gen_random_uuid(),
  meeting_id      uuid not null references sunday_meetings(id) on delete cascade,
  volunteer_name  text,
  witness_1_name  text,
  witness_2_name  text,
  -- Los sobres son dato de control: la plata que tenian adentro ya esta
  -- contada en las lineas por denominacion. NO suma al total.
  envelopes_count integer not null default 0 check (envelopes_count >= 0),
  notes           text,
  status          offering_count_status not null default 'draft',
  public_id       text not null unique default public.gen_public_id(10),
  finalized_at    timestamptz,
  pdf_path        text,
  voided_reason   text,
  supersedes_id   uuid references offering_counts(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- Una sola acta vigente por reunion; las anuladas no cuentan.
create unique index offering_counts_active_per_meeting
  on offering_counts (meeting_id) where status <> 'voided';

create table offering_count_lines (
  id                 uuid primary key default gen_random_uuid(),
  offering_count_id  uuid not null references offering_counts(id) on delete cascade,
  currency_code      text not null references currencies(code),
  denomination_value numeric(14,2) not null check (denomination_value > 0),
  quantity           integer not null check (quantity > 0),
  subtotal           numeric(16,2) generated always as (denomination_value * quantity) stored,
  unique (offering_count_id, currency_code, denomination_value)
);

-- Un acta finalizada es inmutable: si hubo error se anula y se hace una nueva.
create or replace function public.guard_finalized_count()
returns trigger language plpgsql as $fn$
declare current_status offering_count_status;
begin
  if tg_table_name = 'offering_counts' then
    if tg_op = 'UPDATE' and old.status = 'finalized' then
      -- adjuntar el PDF recien generado es la unica escritura permitida
      if new.status = 'finalized' and new.pdf_path is distinct from old.pdf_path then
        return new;
      end if;
      if new.status <> 'voided' then
        raise exception 'Un acta finalizada no se puede editar. Anulala y crea una nueva.';
      end if;
    end if;
    if tg_op = 'DELETE' and old.status = 'finalized' then
      raise exception 'Un acta finalizada no se puede borrar.';
    end if;
    return coalesce(new, old);
  else
    select oc.status into current_status from offering_counts oc
      where oc.id = coalesce(new.offering_count_id, old.offering_count_id);
    if current_status <> 'draft' then
      raise exception 'Las lineas de un acta % no se pueden modificar.', current_status;
    end if;
    return coalesce(new, old);
  end if;
end;
$fn$;

create trigger offering_counts_guard before update or delete on offering_counts
  for each row execute function public.guard_finalized_count();
create trigger offering_count_lines_guard before insert or update or delete on offering_count_lines
  for each row execute function public.guard_finalized_count();
create trigger offering_counts_touch before update on offering_counts
  for each row execute function public.touch_updated_at();

-- ---------- Ingresos digitales de la reunion (MercadoPago) ----------
create table meeting_incomes (
  id              uuid primary key default gen_random_uuid(),
  meeting_id      uuid not null references sunday_meetings(id) on delete cascade,
  concept         text not null default 'mercadopago' check (concept in ('mercadopago')),
  currency_code   text not null references currencies(code),
  amount          numeric(16,2) not null check (amount > 0),
  reference       text,
  notes           text,
  created_by_name text,
  created_at      timestamptz not null default now()
);
create index meeting_incomes_meeting_idx on meeting_incomes (meeting_id);

-- ---------- Ventas ----------
create table products (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,
  price           numeric(14,2) not null check (price >= 0),
  currency_code   text not null references currencies(code),
  sort_order      smallint not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index products_org_idx on products (organization_id) where is_active;
create trigger products_touch before update on products
  for each row execute function public.touch_updated_at();

-- La venta es plata aparte de la ofrenda: no entra en el acta de conteo, ni
-- siquiera cobrada en efectivo. El medio de pago se guarda para poder abrir
-- el total de ventas por como se cobro.
create table sales (
  id             uuid primary key default gen_random_uuid(),
  meeting_id     uuid not null references sunday_meetings(id) on delete cascade,
  payment_method text not null check (payment_method in ('cash', 'mercadopago')),
  currency_code  text not null references currencies(code),
  seller_name    text,
  notes          text,
  created_at     timestamptz not null default now()
);
create index sales_meeting_idx on sales (meeting_id);

create table sale_lines (
  id           uuid primary key default gen_random_uuid(),
  sale_id      uuid not null references sales(id) on delete cascade,
  product_id   uuid not null references products(id) on delete restrict,
  product_name text not null,
  quantity     integer not null check (quantity > 0),
  unit_price   numeric(14,2) not null check (unit_price >= 0),
  subtotal     numeric(16,2) generated always as (unit_price * quantity) stored
);
create index sale_lines_sale_idx on sale_lines (sale_id);

-- ---------- Helpers de scoping ----------
-- Las tablas colgadas de una reunion heredan el permiso del domingo padre.
create or replace function public.meeting_org(meeting uuid)
returns uuid language sql stable security definer set search_path = public as $fn$
  select s.organization_id
  from sunday_meetings m join sundays s on s.id = m.sunday_id
  where m.id = meeting;
$fn$;

create or replace function public.count_org(count_id uuid)
returns uuid language sql stable security definer set search_path = public as $fn$
  select public.meeting_org(oc.meeting_id) from offering_counts oc where oc.id = count_id;
$fn$;

create or replace function public.sale_org(s_id uuid)
returns uuid language sql stable security definer set search_path = public as $fn$
  select public.meeting_org(s.meeting_id) from sales s where s.id = s_id;
$fn$;

create or replace function public.sunday_org(s_id uuid)
returns uuid language sql stable security definer set search_path = public as $fn$
  select s.organization_id from sundays s where s.id = s_id;
$fn$;

-- ---------- RLS ----------
-- La superficie publica (/r/<publicId>) NO pasa por estas policies: usa el
-- cliente service-role desde el servidor, porque un voluntario anonimo no
-- tiene auth.uid(). Estas policies cubren solo la app autenticada.
alter table meeting_templates    enable row level security;
alter table sundays              enable row level security;
alter table sunday_meetings      enable row level security;
alter table offering_counts      enable row level security;
alter table offering_count_lines enable row level security;
alter table meeting_incomes      enable row level security;
alter table products             enable row level security;
alter table sales                enable row level security;
alter table sale_lines           enable row level security;

create policy meeting_templates_read on meeting_templates
  for select to authenticated using (public.is_org_member(organization_id));
create policy meeting_templates_write on meeting_templates
  for all to authenticated
  using (public.can_admin(organization_id)) with check (public.can_admin(organization_id));

create policy sundays_read on sundays
  for select to authenticated using (public.is_org_member(organization_id));
create policy sundays_write on sundays
  for all to authenticated
  using (public.can_write(organization_id)) with check (public.can_write(organization_id));

create policy products_read on products
  for select to authenticated using (public.is_org_member(organization_id));
create policy products_write on products
  for all to authenticated
  using (public.can_admin(organization_id)) with check (public.can_admin(organization_id));

create policy sunday_meetings_read on sunday_meetings
  for select to authenticated using (public.is_org_member(public.sunday_org(sunday_id)));
create policy sunday_meetings_write on sunday_meetings
  for all to authenticated
  using (public.can_write(public.sunday_org(sunday_id)))
  with check (public.can_write(public.sunday_org(sunday_id)));

create policy meeting_incomes_read on meeting_incomes
  for select to authenticated using (public.is_org_member(public.meeting_org(meeting_id)));
create policy meeting_incomes_write on meeting_incomes
  for all to authenticated
  using (public.can_write(public.meeting_org(meeting_id)))
  with check (public.can_write(public.meeting_org(meeting_id)));

create policy sales_read on sales
  for select to authenticated using (public.is_org_member(public.meeting_org(meeting_id)));
create policy sales_write on sales
  for all to authenticated
  using (public.can_write(public.meeting_org(meeting_id)))
  with check (public.can_write(public.meeting_org(meeting_id)));

create policy offering_counts_read on offering_counts
  for select to authenticated using (public.is_org_member(public.meeting_org(meeting_id)));
create policy offering_counts_write on offering_counts
  for all to authenticated
  using (public.can_write(public.meeting_org(meeting_id)))
  with check (public.can_write(public.meeting_org(meeting_id)));

create policy offering_count_lines_read on offering_count_lines
  for select to authenticated using (public.is_org_member(public.count_org(offering_count_id)));
create policy offering_count_lines_write on offering_count_lines
  for all to authenticated
  using (public.can_write(public.count_org(offering_count_id)))
  with check (public.can_write(public.count_org(offering_count_id)));

create policy sale_lines_read on sale_lines
  for select to authenticated using (public.is_org_member(public.sale_org(sale_id)));
create policy sale_lines_write on sale_lines
  for all to authenticated
  using (public.can_write(public.sale_org(sale_id)))
  with check (public.can_write(public.sale_org(sale_id)));
