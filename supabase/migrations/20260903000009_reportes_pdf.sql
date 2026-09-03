-- =============================================================
-- Denario v2 — El PDF del Profit & Loss se guarda al cerrarlo
--
-- Hasta ahora el PDF se armaba cada vez que alguien lo pedia, incluso con el
-- reporte en borrador. Eso deja circulando papeles de numeros a medio cargar
-- que se parecen al definitivo, y el que lo manda a HF no tiene forma de
-- saber cual era cual.
--
-- Cerrar el reporte es lo que lo vuelve inmutable, asi que es el momento de
-- congelarlo en un archivo. Reabrir y volver a cerrar lo regenera.
-- =============================================================

alter table pl_reports add column pdf_path text;

-- ---------- Bucket ----------
-- Aparte de `actas` porque el criterio de permiso es otro: las actas se
-- resuelven por el domingo que nombra el path y un reporte no cuelga de
-- ningun domingo. Aca el path lleva el campus directo.
--
--   <organization_id>/<campus_id>/<archivo>.pdf
insert into storage.buckets (id, name, public)
values ('reportes', 'reportes', false)
on conflict (id) do nothing;

/**
 * El campus que nombra el path de un reporte. Segundo segmento.
 */
create or replace function public.reporte_campus(object_name text)
returns uuid language sql immutable as $fn$
  select (split_part(object_name, '/', 2))::uuid
  where split_part(object_name, '/', 2) ~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$';
$fn$;

-- Mismo criterio que la tabla: lo lee quien puede ver ese campus, lo escribe
-- quien puede cargar en el (la accion que cierra el reporte).
create policy reportes_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'reportes'
    and public.can_read_campus(public.acta_org(name), public.reporte_campus(name))
  );

create policy reportes_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'reportes'
    and public.can_write_campus(public.acta_org(name), public.reporte_campus(name))
  );

create policy reportes_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'reportes'
    and public.can_write_campus(public.acta_org(name), public.reporte_campus(name))
  )
  with check (
    bucket_id = 'reportes'
    and public.can_write_campus(public.acta_org(name), public.reporte_campus(name))
  );
