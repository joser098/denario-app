-- =============================================================
-- Denario v2 — Actas en PDF: permisos del bucket privado
--
-- Los archivos se guardan como  <organization_id>/<sunday_id>/<archivo>.pdf
-- El primer segmento del path es la organizacion duena del archivo, y es lo
-- que usan estas policies para decidir. Asi el PDF se sirve con el mismo
-- criterio que las filas que lo originaron, sin service-role de por medio.
-- =============================================================

create or replace function public.acta_org(object_name text)
returns uuid language sql immutable as $fn$
  select (split_part(object_name, '/', 1))::uuid
  where split_part(object_name, '/', 1) ~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$';
$fn$;

-- Los miembros leen las actas de su organizacion; el que puede cargar plata,
-- ademas las escribe (el PDF lo genera la misma accion que firma el acta).
create policy actas_read on storage.objects
  for select to authenticated
  using (bucket_id = 'actas' and public.is_org_member(public.acta_org(name)));

create policy actas_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'actas' and public.can_write(public.acta_org(name)));

create policy actas_update on storage.objects
  for update to authenticated
  using (bucket_id = 'actas' and public.can_write(public.acta_org(name)))
  with check (bucket_id = 'actas' and public.can_write(public.acta_org(name)));
