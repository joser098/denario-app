-- =============================================================
-- Denario v2 — Logo de la organizacion
--
-- Bucket publico: el logo de una iglesia no es un dato sensible y asi la
-- barra lateral lo pide con una URL comun, sin firmar nada en cada pantalla.
-- Lo que si esta cerrado es la escritura: solo un admin de esa organizacion.
--
-- Mismo criterio de path que las actas: <organization_id>/<archivo>, y se
-- reutiliza public.acta_org(), que no es mas que "el primer segmento del
-- path como uuid de organizacion".
-- =============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', true, 2097152, array['image/png', 'image/jpeg'])
on conflict (id) do update
  set public = true,
      file_size_limit = 2097152,
      allowed_mime_types = array['image/png', 'image/jpeg'];

create policy logos_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'logos' and public.can_admin(public.acta_org(name)));

create policy logos_update on storage.objects
  for update to authenticated
  using (bucket_id = 'logos' and public.can_admin(public.acta_org(name)))
  with check (bucket_id = 'logos' and public.can_admin(public.acta_org(name)));

create policy logos_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'logos' and public.can_admin(public.acta_org(name)));
