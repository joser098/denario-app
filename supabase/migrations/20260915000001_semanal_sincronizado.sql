-- =============================================================
-- Denario v2 — Domingos alimenta Semanal, y Semanal alimenta Profit & Loss
--
-- Hasta aca los tres modulos eran islas y cada numero se cargaba tres veces:
-- la ofrenda se contaba en el acta del domingo, se volvia a tipear en el
-- libro semanal y se tipeaba una tercera vez en el reporte que se manda a
-- HF. Tres copias del mismo peso, y ninguna forma de saber cual miente.
--
-- Ahora la plata corre en un solo sentido:
--
--   DOMINGO  --(al cerrarlo)-->  SEMANAL  --(al cerrarlo)-->  PROFIT & LOSS
--
-- Lo que cambia en la base:
--
--   1. El periodo del Semanal lo abre un administrador y se abre igual en
--      todos los campus, junto con el Profit & Loss de cada uno. Por eso el
--      reporte deja de ser "de un domingo" y pasa a cubrir el mismo periodo
--      que la semana que lo origino.
--   2. Los conceptos del Semanal dicen a que renglon de ingresos del P&L
--      van, y los egresos llevan encima su categoria de gasto del P&L.
--   3. Aparecen conceptos que cuentan pero no son plata: Transacciones deja
--      de sumar al total (su monto ya estaba contado en MercadoPago y en
--      Transferencias) y se suma Sobres, que baja del domingo. Los dos
--      juntos son los que participaron de la ofrenda.
--   4. La cotizacion deja de ser "la del domingo" y pasa a ser la del
--      periodo, que es lo que ahora identifica a un reporte.
-- =============================================================

-- ---------- 1. El cierre del Semanal deja su PDF ----------
-- Mismo criterio que el acta del domingo y que el P&L: el papel se congela
-- al cerrar, no se rearma cada vez que alguien lo pide.
alter table weeks add column pdf_path text;

-- ---------- 2. Conceptos: a donde van, y cuales no son plata ----------
alter table week_concepts
  -- El renglon de ingresos del P&L que este concepto alimenta. Null = no
  -- baja al reporte (queda en el libro semanal y nada mas).
  add column pl_revenue_key text,
  -- Cuenta movimientos pero no plata. El monto no suma a ningun total: son
  -- los datos de control (transacciones, sobres) que terminan en la
  -- participacion del reporte.
  add column counts_only boolean not null default false;

alter table week_concepts add constraint week_concepts_pl_revenue_key_valid
  check (pl_revenue_key is null or pl_revenue_key in (
    'rev_tithes_offerings', 'rev_hf_operation_support', 'rev_other_donations',
    'rev_conferences_events', 'rev_commercial_activities', 'rev_other_income'
  ));

-- Un concepto que no es plata no puede alimentar un renglon de plata.
alter table week_concepts add constraint week_concepts_counts_only_has_no_revenue
  check (not (counts_only and pl_revenue_key is not null));

-- La ofrenda entra por tres puertas —efectivo, MercadoPago, transferencia—
-- pero para HF es un solo renglon.
update week_concepts set pl_revenue_key = 'rev_tithes_offerings'
  where code in ('efectivo', 'mercadopago', 'transferencia_macro');

update week_concepts set pl_revenue_key = 'rev_commercial_activities'
  where code = 'actividad_comercial';

-- Transacciones no es dinero: es cuantas operaciones hubo. El monto que se
-- venia cargando ya estaba contado en las otras lineas, asi que sumarlo era
-- contar dos veces. Las filas viejas quedan —son historia— pero dejan de
-- sumar: la vista de totales ahora las saltea.
update week_concepts set counts_only = true, pl_revenue_key = null
  where code = 'transacciones';

-- ---------- Sobres ----------
-- Baja del domingo junto con la plata. No es plata: lo que venia adentro ya
-- esta contado en las denominaciones del acta.
insert into week_concepts (
  organization_id, code, name, allowed_currencies, has_movement_count,
  counts_only, kind, sort_order
) values (null, 'sobres', 'Sobres', array['ARS'], true, true, 'income', 45);

insert into week_concepts (
  organization_id, code, name, allowed_currencies, has_movement_count,
  counts_only, pl_revenue_key, kind, sort_order
)
select o.id, t.code, t.name, t.allowed_currencies, t.has_movement_count,
       t.counts_only, t.pl_revenue_key, t.kind, t.sort_order
from organizations o
cross join week_concepts t
where t.organization_id is null
  and t.code = 'sobres'
  and not exists (
    select 1 from week_concepts c where c.organization_id = o.id and c.code = t.code
  );

-- ---------- 3. La categoria de gasto del P&L ----------
-- Vive en el movimiento y no en el concepto porque el concepto dice de donde
-- salio el gasto (una compra, un presupuesto, un pago en efectivo) y eso no
-- alcanza para saber en que renglon del reporte cae: dos compras pueden ser
-- una de personal y otra de instalaciones.
alter table week_entries add column pl_expense_key text;

alter table week_entries add constraint week_entries_pl_expense_key_valid
  check (pl_expense_key is null or pl_expense_key in (
    'exp_personnel', 'exp_program', 'exp_administration', 'exp_facilities',
    'exp_facilities_loans', 'exp_conferences_events', 'exp_commercial_activities',
    'exp_assets_purchased', 'exp_depreciation'
  ));

create index week_entries_pl_expense_idx on week_entries (week_id, pl_expense_key)
  where pl_expense_key is not null;

-- ---------- Un concepto que no es plata no valida moneda ----------
-- Sobres y Transacciones se cargan con monto cero y la moneda no significa
-- nada, asi que exigir que este habilitada seria pedir un dato inventado.
create or replace function public.validate_week_entry()
returns trigger language plpgsql as $fn$
declare
  allowed  text[];
  counting boolean;
  w_start  date;
  w_end    date;
  w_status week_status;
begin
  select c.allowed_currencies, c.counts_only into allowed, counting
    from week_concepts c where c.id = new.concept_id;

  if not counting and not (new.currency_code = any (allowed)) then
    raise exception 'El concepto no admite la moneda %', new.currency_code;
  end if;

  select w.start_date, w.end_date, w.status into w_start, w_end, w_status
    from weeks w where w.id = new.week_id;
  if w_status = 'closed' then
    raise exception 'El periodo esta cerrado.';
  end if;
  if new.entry_date is not null and (new.entry_date < w_start or new.entry_date > w_end) then
    raise exception 'La fecha % cae fuera del periodo % a %', new.entry_date, w_start, w_end;
  end if;
  return new;
end;
$fn$;

-- ---------- 4. Totales: la plata por un lado, lo que se cuenta por otro ----------
drop view if exists public.week_amounts;

create view public.week_amounts
with (security_invoker = true) as
  select
    e.week_id,
    c.kind,
    e.currency_code,
    sum(e.amount)                      as amount,
    sum(coalesce(e.movement_count, 0)) as movements
  from week_entries e
  join week_concepts c on c.id = e.concept_id
  where not c.counts_only
  group by e.week_id, c.kind, e.currency_code;

grant select on public.week_amounts to authenticated;

-- Los datos de control del periodo. Transacciones + sobres es lo que el
-- reporte llama participacion.
create view public.week_counts
with (security_invoker = true) as
  select
    e.week_id,
    c.code,
    c.name,
    sum(coalesce(e.movement_count, 0)) as movements
  from week_entries e
  join week_concepts c on c.id = e.concept_id
  where c.counts_only
  group by e.week_id, c.code, c.name;

grant select on public.week_counts to authenticated;

-- ---------- 5. El reporte cubre el periodo, no el domingo ----------
-- La vista se cae y se rearma: nombra service_date, que esta por irse.
drop view if exists public.pl_report_totals;

alter table pl_reports
  add column week_id    uuid references weeks(id) on delete set null,
  add column start_date date,
  add column end_date   date;

-- Los reportes que ya existian eran de un domingo: ese domingo pasa a ser un
-- periodo de un dia, salvo que caiga dentro de una semana de su campus — ahi
-- se adopta el periodo de esa semana y quedan atados.
update pl_reports set start_date = service_date, end_date = service_date;

update pl_reports r
   set week_id = w.id, start_date = w.start_date, end_date = w.end_date
  from weeks w
 where w.campus_id = r.campus_id
   and r.service_date between w.start_date and w.end_date;

alter table pl_reports
  alter column start_date set not null,
  alter column end_date set not null,
  add constraint pl_reports_range_valid check (end_date >= start_date);

-- Se lleva puestos el check de domingo, el unique por domingo y los dos
-- indices que lo nombraban: son de la columna que se va.
alter table pl_reports drop column service_date;

-- Un reporte por semana y, mirado desde el otro lado, uno por campus y
-- periodo. Los reportes viejos sin semana (un domingo suelto) no chocan
-- entre si porque su start_date sigue siendo el del domingo.
create unique index pl_reports_one_per_week on pl_reports (week_id)
  where week_id is not null;
create unique index pl_reports_campus_period on pl_reports (campus_id, start_date);
create index pl_reports_org_period_idx on pl_reports (organization_id, start_date desc);

create view public.pl_report_totals
with (security_invoker = true) as
  select
    r.id as report_id,
    r.campus_id,
    r.organization_id,
    r.week_id,
    r.start_date,
    r.end_date,
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

-- ---------- 6. La cotizacion es del periodo ----------
-- Antes se cargaba por domingo porque el domingo identificaba al reporte.
-- Ahora lo identifica el periodo, y la cotizacion lo sigue: es la que se usa
-- para pasar a moneda local dentro del Semanal y para consolidar en dolares.
alter table exchange_rates drop constraint exchange_rates_is_sunday;
alter table exchange_rates rename column service_date to period_start;
alter index exchange_rates_lookup_idx rename to exchange_rates_period_idx;

-- ---------- 7. Abrir el periodo ----------
-- Una sola operacion para toda la organizacion: la semana de cada campus y
-- su reporte. Todo o nada — un campus que quede sin periodo es un campus que
-- despues no puede registrar un gasto, y nadie se entera hasta que pasa.
--
-- Security invoker: las policies de weeks y pl_reports siguen decidiendo.
-- El can_admin de aca es para cortar antes y con un mensaje que se entienda.
create or replace function public.open_period(p_org uuid, p_start date, p_end date)
returns integer
language plpgsql as $fn$
declare
  v_campus record;
  v_week   uuid;
  v_count  integer := 0;
begin
  if p_end < p_start then
    raise exception 'El "hasta" no puede ser anterior al "desde".';
  end if;

  if not public.can_admin(p_org) then
    raise exception 'Solo un administrador abre el periodo.';
  end if;

  for v_campus in
    select id, default_currency from campuses
    where organization_id = p_org and is_active
    order by created_at, id
  loop
    insert into weeks (organization_id, campus_id, start_date, end_date)
    values (p_org, v_campus.id, p_start, p_end)
    returning id into v_week;

    insert into pl_reports (
      organization_id, campus_id, week_id, start_date, end_date, currency_code, created_by
    )
    values (p_org, v_campus.id, v_week, p_start, p_end, v_campus.default_currency, auth.uid());

    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'La organizacion no tiene campus activos.';
  end if;

  return v_count;
end;
$fn$;

revoke all on function public.open_period(uuid, date, date) from public;
grant execute on function public.open_period(uuid, date, date) to authenticated;

-- ---------- 8. Las organizaciones nuevas nacen con todo esto ----------
create or replace function public.create_organization(
  p_name     text,
  p_slug     text,
  p_timezone text default 'America/Argentina/Buenos_Aires',
  p_currency text default 'ARS'
) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_org    uuid;
  v_campus uuid;
  v_user   uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Necesitas una sesion activa para crear una organizacion.';
  end if;

  insert into organizations (name, slug, timezone, default_currency)
  values (p_name, p_slug, p_timezone, p_currency)
  returning id into v_org;

  insert into organization_members (organization_id, user_id, role)
  values (v_org, v_user, 'owner');

  insert into campuses (organization_id, name, slug, default_currency, timezone)
  values (v_org, 'Campus Principal', 'campus-principal', p_currency, p_timezone)
  returning id into v_campus;

  insert into meeting_templates (organization_id, campus_id, label, start_time, sort_order) values
    (v_org, v_campus, 'Reunion 1', '10:30', 10),
    (v_org, v_campus, 'Reunion 2', '12:30', 20),
    (v_org, v_campus, 'Reunion 3', '17:30', 30),
    (v_org, v_campus, 'Reunion 4', '20:00', 40);

  insert into week_concepts (
    organization_id, code, name, allowed_currencies, has_movement_count,
    counts_only, pl_revenue_key, kind, sort_order
  )
  select v_org, code, name, allowed_currencies, has_movement_count,
         counts_only, pl_revenue_key, kind, sort_order
  from week_concepts where organization_id is null;

  return v_org;
end;
$fn$;
