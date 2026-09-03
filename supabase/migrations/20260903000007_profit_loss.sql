-- =============================================================
-- Denario v2 — Profit & Loss report, por campus y por domingo
--
-- El reporte que cada campus manda el miercoles siguiente al domingo. No se
-- alimenta de Domingos ni del Semanal: son numeros que la tesoreria del
-- campus arma aparte y carga a mano.
--
-- La unidad es el domingo, no una semana abstracta. Asi el reporte mensual
-- es la suma de los domingos de ese mes y no hay una segunda carga: un
-- reporte mensual que se cargara por separado terminaria discrepando con la
-- suma de los semanales, y no habria forma de saber cual miente.
--
-- Los montos van en la moneda del campus. La consolidacion a USD de toda la
-- organizacion es otra cosa y necesita cotizaciones; todavia no esta.
-- =============================================================

create type pl_report_status as enum ('draft', 'closed');

create table pl_reports (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  campus_id       uuid not null references campuses(id) on delete cascade,
  -- El domingo que cubre. Es la identidad del reporte.
  service_date    date not null,
  -- Se congela al crear: si el campus cambia de moneda, los reportes viejos
  -- siguen diciendo en que moneda estaban esos numeros.
  currency_code   text not null references currencies(code),
  status          pl_report_status not null default 'draft',

  -- ---------- Ingresos ----------
  rev_tithes_offerings       numeric(16,2) not null default 0 check (rev_tithes_offerings >= 0),
  rev_hf_operation_support   numeric(16,2) not null default 0 check (rev_hf_operation_support >= 0),
  rev_other_donations        numeric(16,2) not null default 0 check (rev_other_donations >= 0),
  rev_conferences_events     numeric(16,2) not null default 0 check (rev_conferences_events >= 0),
  rev_commercial_activities  numeric(16,2) not null default 0 check (rev_commercial_activities >= 0),
  rev_other_income           numeric(16,2) not null default 0 check (rev_other_income >= 0),

  -- ---------- Egresos ----------
  -- Las dos contribuciones no estan aca: salen del total de ingresos por el
  -- porcentaje de mas abajo.
  exp_personnel              numeric(16,2) not null default 0 check (exp_personnel >= 0),
  exp_program                numeric(16,2) not null default 0 check (exp_program >= 0),
  exp_administration         numeric(16,2) not null default 0 check (exp_administration >= 0),
  exp_facilities             numeric(16,2) not null default 0 check (exp_facilities >= 0),
  exp_facilities_loans       numeric(16,2) not null default 0 check (exp_facilities_loans >= 0),
  exp_conferences_events     numeric(16,2) not null default 0 check (exp_conferences_events >= 0),
  exp_commercial_activities  numeric(16,2) not null default 0 check (exp_commercial_activities >= 0),
  exp_assets_purchased       numeric(16,2) not null default 0 check (exp_assets_purchased >= 0),
  exp_depreciation           numeric(16,2) not null default 0 check (exp_depreciation >= 0),

  -- Los porcentajes viven en la fila, no en el codigo: si HF cambia el 5% el
  -- año que viene, los reportes ya cerrados tienen que seguir diciendo lo
  -- que dijeron. Calcularlos con una constante los reescribiria a todos.
  global_rate       numeric(6,4) not null default 0.05 check (global_rate between 0 and 1),
  continental_rate  numeric(6,4) not null default 0.01 check (continental_rate between 0 and 1),

  -- ---------- Metricas ----------
  attendance   integer not null default 0 check (attendance >= 0),
  participants integer not null default 0 check (participants >= 0),
  salvations   integer not null default 0 check (salvations >= 0),

  notes       text,
  created_by  uuid references auth.users(id) on delete set null,
  closed_at   timestamptz,
  closed_by   uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- El domingo tiene que ser domingo. isodow: domingo = 7.
  constraint pl_reports_is_sunday check (extract(isodow from service_date) = 7),
  -- Los que participan de la ofrenda no pueden ser mas que los que vinieron.
  constraint pl_reports_participants_fit check (participants <= attendance),
  unique (campus_id, service_date)
);

create index pl_reports_org_date_idx on pl_reports (organization_id, service_date desc);
create index pl_reports_campus_date_idx on pl_reports (campus_id, service_date desc);

create trigger pl_reports_touch before update on pl_reports
  for each row execute function public.touch_updated_at();

-- ---------- Totales ----------
-- Una vista y no columnas calculadas: los totales son lecturas derivadas y
-- guardarlos abriria la puerta a que discrepen con sus partes. security_invoker
-- para que respete las policies de pl_reports.
create view public.pl_report_totals
with (security_invoker = true) as
  select
    r.id as report_id,
    r.campus_id,
    r.organization_id,
    r.service_date,
    r.currency_code,
    (r.rev_tithes_offerings + r.rev_hf_operation_support + r.rev_other_donations
      + r.rev_conferences_events + r.rev_commercial_activities + r.rev_other_income)
      as revenue,
    round((r.rev_tithes_offerings + r.rev_hf_operation_support + r.rev_other_donations
      + r.rev_conferences_events + r.rev_commercial_activities + r.rev_other_income)
      * r.global_rate, 2) as global_contribution,
    round((r.rev_tithes_offerings + r.rev_hf_operation_support + r.rev_other_donations
      + r.rev_conferences_events + r.rev_commercial_activities + r.rev_other_income)
      * r.continental_rate, 2) as continental_contribution,
    (r.exp_personnel + r.exp_program + r.exp_administration + r.exp_facilities
      + r.exp_facilities_loans + r.exp_conferences_events + r.exp_commercial_activities
      + r.exp_assets_purchased + r.exp_depreciation)
      as expenses_loaded
  from pl_reports r;

grant select on public.pl_report_totals to authenticated;

-- ---------- RLS ----------
-- Mismo criterio que el resto: el campus es parte del permiso, y el tesorero
-- del campus carga el suyo.
alter table pl_reports enable row level security;

create policy pl_reports_read on pl_reports
  for select to authenticated
  using (public.can_read_campus(organization_id, campus_id));

create policy pl_reports_write on pl_reports
  for all to authenticated
  using (public.can_write_campus(organization_id, campus_id))
  with check (public.can_write_campus(organization_id, campus_id));
