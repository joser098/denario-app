-- =============================================================
-- Denario v2 — El periodo del Semanal lo elige quien lo abre
--
-- Hasta aca el libro semanal era martes a lunes y punto: la fecha elegida se
-- corria al martes y el periodo duraba siete dias. Ademas se abria solo, al
-- registrar un gasto cuya fecha no cayera en ningun periodo existente.
--
-- Las dos cosas se van. El periodo es un rango libre que abre una persona, y
-- un gasto que no cae en ninguno corta la operacion en vez de inventar uno.
--
-- Lo que reemplaza a los checks: dos periodos del mismo campus no se pueden
-- pisar. Sin eso "el periodo que contiene el 12/9" tendria mas de una
-- respuesta y el gasto no sabria donde caer. El unique por start_date sobra:
-- si no se pisan, tampoco pueden arrancar el mismo dia.
--
-- btree_gist es lo que deja mezclar la igualdad de campus_id con el solape
-- del rango en la misma constraint.
-- =============================================================

create extension if not exists btree_gist with schema extensions;

alter table weeks
  drop constraint weeks_starts_tuesday,
  drop constraint weeks_seven_days;

alter table weeks
  add constraint weeks_range_valid check (end_date >= start_date);

drop index weeks_unique_slot;

-- '[]': los dos extremos entran en el periodo. Un periodo que termina el 7 y
-- otro que arranca el 7 se pisan, y tienen que hacerlo: un gasto del 7 caeria
-- en los dos.
alter table weeks
  add constraint weeks_no_overlap
  exclude using gist (
    campus_id extensions.gist_uuid_ops with =,
    daterange(start_date, end_date, '[]') with &&
  );

-- El trigger sigue valiendo igual (compara contra start_date/end_date, no
-- contra un martes), pero sus mensajes le hablan al usuario de "la semana".
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
    raise exception 'El periodo esta cerrado.';
  end if;
  if new.entry_date is not null and (new.entry_date < w_start or new.entry_date > w_end) then
    raise exception 'La fecha % cae fuera del periodo % a %', new.entry_date, w_start, w_end;
  end if;
  return new;
end;
$fn$;
