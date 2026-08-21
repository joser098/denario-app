-- =============================================================
-- Denario v2 — Domingos: abrir la fecha y totales agregados
-- =============================================================

-- ---------- Abrir un domingo ----------
-- Crear el domingo y sus reuniones tiene que ser una sola operacion: un
-- domingo sin reuniones no sirve para nada y habria que borrarlo a mano.
-- Security invoker (el default): las policies de sundays y sunday_meetings
-- siguen decidiendo quien puede.
create or replace function public.open_sunday(p_campus uuid, p_date date)
returns uuid
language plpgsql as $fn$
declare
  v_org    uuid;
  v_sunday uuid;
begin
  select c.organization_id into v_org from campuses c where c.id = p_campus;
  if v_org is null then
    raise exception 'Ese campus no existe o no lo podés ver.';
  end if;

  insert into sundays (organization_id, campus_id, service_date)
  values (v_org, p_campus, p_date)
  returning id into v_sunday;

  insert into sunday_meetings (sunday_id, label, start_time, sort_order)
  select v_sunday, t.label, t.start_time, t.sort_order
  from meeting_templates t
  where t.campus_id = p_campus and t.is_active;

  return v_sunday;
end;
$fn$;

revoke all on function public.open_sunday(uuid, date) from public;
grant execute on function public.open_sunday(uuid, date) to authenticated;

-- ---------- Totales por reunion ----------
-- Una fila por (reunion, moneda, tipo de plata). No se suman monedas entre si
-- y cada origen queda separado, porque la venta en efectivo ya esta contada en
-- las denominaciones del acta y sumarla de nuevo seria contar dos veces.
--
-- security_invoker: la vista lee con los permisos de quien consulta, no del
-- dueño. Sin esto, cualquier miembro veria los totales de todas las iglesias.
create or replace view public.meeting_amounts
with (security_invoker = true) as
  select
    m.id        as meeting_id,
    m.sunday_id as sunday_id,
    l.currency_code,
    'offering'::text as kind,
    sum(l.subtotal)  as amount
  from sunday_meetings m
  join offering_counts oc on oc.meeting_id = m.id and oc.status = 'finalized'
  join offering_count_lines l on l.offering_count_id = oc.id
  group by m.id, m.sunday_id, l.currency_code

  union all

  select
    m.id,
    m.sunday_id,
    s.currency_code,
    case when s.payment_method = 'cash' then 'sale_cash' else 'sale_mp' end,
    sum(sl.subtotal)
  from sunday_meetings m
  join sales s on s.meeting_id = m.id
  join sale_lines sl on sl.sale_id = s.id
  group by m.id, m.sunday_id, s.currency_code, s.payment_method

  union all

  select
    m.id,
    m.sunday_id,
    i.currency_code,
    'income_mp'::text,
    sum(i.amount)
  from sunday_meetings m
  join meeting_incomes i on i.meeting_id = m.id
  group by m.id, m.sunday_id, i.currency_code;

grant select on public.meeting_amounts to authenticated;
