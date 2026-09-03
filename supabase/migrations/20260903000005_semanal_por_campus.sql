-- =============================================================
-- Denario v2 — El Semanal es siempre de un campus
--
-- La semana "de toda la organizacion" (campus_id null) se va. Cuando cada
-- campus maneja su propia moneda, un libro que los mezcla no cierra: sumar
-- dos campus que cobran en monedas distintas no da un numero que signifique
-- algo, y mantener esa consistencia a mano es trabajo que nadie va a hacer.
--
-- Toda semana pasa a tener campus. Las que ya existian se mudan al campus
-- mas viejo de su organizacion; si ese campus ya tenia la semana de esa
-- fecha, los movimientos se fusionan en la que ya estaba y la vieja se borra.
--
-- Los egresos de Gastos ya venian cayendo en la semana del campus desde la
-- 20260903000002, asi que de aca en adelante no se generan mas huerfanas.
-- =============================================================

-- El trigger de week_entries rechaza tocar un movimiento de una semana
-- cerrada. Mover un movimiento de una semana a otra no es cargarlo de nuevo
-- —la plata ya estaba contada—, asi que la validacion se corre al costado
-- solo para esta migracion.
alter table week_entries disable trigger week_entries_validate;

do $migrar$
declare
  r        record;
  v_destino uuid;
begin
  for r in
    select w.id, w.organization_id, w.start_date,
           (select c.id from campuses c
             where c.organization_id = w.organization_id
             order by c.created_at, c.id
             limit 1) as campus
    from weeks w
    where w.campus_id is null
  loop
    -- Una organizacion sin ningun campus no puede tener semanas: no hay
    -- donde ponerlas y no hay nada que reportar.
    if r.campus is null then
      delete from weeks where id = r.id;
      continue;
    end if;

    select id into v_destino
    from weeks
    where organization_id = r.organization_id
      and campus_id = r.campus
      and start_date = r.start_date;

    if v_destino is null then
      update weeks set campus_id = r.campus where id = r.id;
    else
      -- Ya habia semana para ese campus y esa fecha: se fusiona. Las notas de
      -- la semana vieja se pierden a proposito; el numero es lo que importa.
      update week_entries set week_id = v_destino where week_id = r.id;
      delete from weeks where id = r.id;
    end if;
  end loop;
end;
$migrar$;

alter table week_entries enable trigger week_entries_validate;

alter table weeks alter column campus_id set not null;

-- Sin el slot null, el indice deja de necesitar el coalesce que lo simulaba.
drop index weeks_unique_slot;
create unique index weeks_unique_slot on weeks (organization_id, campus_id, start_date);
