-- =============================================================
-- Denario v2 — Semanal: totales agregados
--
-- Una fila por semana y moneda. Igual que en Domingos, security_invoker
-- para que la vista lea con los permisos de quien consulta y no con los
-- del dueño: sin eso, un miembro veria los totales de todas las iglesias.
-- =============================================================

create or replace view public.week_amounts
with (security_invoker = true) as
  select
    e.week_id,
    e.currency_code,
    sum(e.amount)                       as amount,
    sum(coalesce(e.movement_count, 0))  as movements
  from week_entries e
  group by e.week_id, e.currency_code;

grant select on public.week_amounts to authenticated;
