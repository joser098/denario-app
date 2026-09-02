-- =============================================================
-- Denario v2 — Lectura de logos bajo RLS
--
-- El bucket es publico, asi que la barra lateral y los PDF piden el archivo
-- por URL comun y nunca pasan por RLS. Pero la Storage API si: para borrar un
-- objeto primero lo busca, y sin policy de select esa busqueda vuelve vacia.
-- Resultado: "Quitar logo" dejaba el archivo huerfano en el bucket, y
-- reemplazar el logo nunca limpiaba el anterior.
--
-- Mismo criterio que actas_read: los miembros de la organizacion ven las
-- filas de su organizacion. No expone nada nuevo — el archivo ya era publico.
-- =============================================================

create policy logos_read on storage.objects
  for select to authenticated
  using (bucket_id = 'logos' and public.is_org_member(public.acta_org(name)));
