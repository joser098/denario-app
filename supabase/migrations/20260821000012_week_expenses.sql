-- =============================================================
-- Denario v2 — Egresos en el libro semanal
--
-- Hasta acá el Semanal solo registraba plata que entra. Con Compras y
-- Presupuestos aparece el otro lado: el concepto ahora dice si suma o resta,
-- y la semana pasa a tener saldo.
--
-- Los montos siguen guardándose SIEMPRE en positivo: el signo lo pone el
-- concepto. Un monto negativo en la base seria una segunda forma de decir
-- lo mismo, y dos formas de decir lo mismo terminan discrepando.
-- =============================================================

create type week_concept_kind as enum ('income', 'expense');

alter table week_concepts
  add column kind week_concept_kind not null default 'income';

-- ---------- Conceptos de egreso ----------
-- Plantilla del sistema (organization_id null), igual que los de ingreso.
insert into week_concepts (organization_id, code, name, allowed_currencies, kind, sort_order) values
  (null, 'compras',      'Compras',      array['ARS','USD'], 'expense', 110),
  (null, 'presupuestos', 'Presupuestos', array['ARS','USD'], 'expense', 120);

-- Las organizaciones creadas antes de esta migracion no los tendrian: se
-- clonan ahora para que Compras y Presupuestos tengan donde caer.
insert into week_concepts (
  organization_id, code, name, allowed_currencies, has_movement_count, kind, sort_order
)
select o.id, t.code, t.name, t.allowed_currencies, t.has_movement_count, t.kind, t.sort_order
from organizations o
cross join week_concepts t
where t.organization_id is null
  and t.kind = 'expense'
  and not exists (
    select 1 from week_concepts c
    where c.organization_id = o.id and c.code = t.code
  );

-- El bootstrap de organizaciones nuevas tambien tiene que copiar el tipo.
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
    organization_id, code, name, allowed_currencies, has_movement_count, kind, sort_order
  )
  select v_org, code, name, allowed_currencies, has_movement_count, kind, sort_order
  from week_concepts where organization_id is null;

  return v_org;
end;
$fn$;

-- ---------- De donde viene un movimiento ----------
-- Null = lo cargo alguien a mano. Con origen = lo genero un flujo (una
-- compra entregada, un presupuesto pagado) y no se toca desde el Semanal.
alter table week_entries
  add column source_type text,
  add column source_id   uuid,
  add constraint week_entries_source_pair
    check ((source_type is null) = (source_id is null));

create index week_entries_source_idx on week_entries (source_type, source_id)
  where source_type is not null;

-- ---------- Totales con signo ----------
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
  group by e.week_id, c.kind, e.currency_code;

grant select on public.week_amounts to authenticated;
