-- =============================================================
-- Denario v2 — Totales por reunion, con medio de pago
--
-- Corrige el modelo anterior. La ofrenda y las ventas son plata distinta y
-- se cuentan por separado: lo que entra por ventas NO esta dentro del acta
-- de conteo, aunque se haya cobrado en efectivo. Por eso ahora las ventas
-- son una linea propia y el medio de pago es un dato de la fila, no parte
-- del nombre del tipo: agregar un medio nuevo no cambia esta vista.
--
--   kind = 'offering' -> efectivo contado en el acta   (method null)
--   kind = 'sale'     -> ventas                        (method: cash | mercadopago)
--   kind = 'income'   -> ingresos digitales            (method: mercadopago)
-- =============================================================

drop view if exists public.meeting_amounts;

create view public.meeting_amounts
with (security_invoker = true) as
  select
    m.id            as meeting_id,
    m.sunday_id     as sunday_id,
    l.currency_code,
    'offering'::text as kind,
    null::text       as method,
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
    'sale'::text,
    s.payment_method,
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
    'income'::text,
    i.concept,
    sum(i.amount)
  from sunday_meetings m
  join meeting_incomes i on i.meeting_id = m.id
  group by m.id, m.sunday_id, i.currency_code, i.concept;

grant select on public.meeting_amounts to authenticated;
