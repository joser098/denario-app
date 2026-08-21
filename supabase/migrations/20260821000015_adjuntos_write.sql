-- =============================================================
-- Denario v2 — Escritura de comprobantes
--
-- La 013 solo abrio la lectura del bucket. Los comprobantes los sube la
-- tesoreria desde la app, asi que falta el insert: mismo criterio de path
-- que actas y logos, <organization_id>/...
-- =============================================================

create policy adjuntos_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'adjuntos' and public.can_write(public.acta_org(name)));
