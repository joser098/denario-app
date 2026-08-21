-- =============================================================
-- Denario v2 — Las organizaciones nuevas nacen con medios de pago
--
-- La 013 sembro el catalogo para las organizaciones que ya existian; esto
-- cierra el otro lado: el bootstrap tambien lo crea.
-- =============================================================

create or replace function public.create_organization(
  p_name     text,
  p_slug     text,
  p_timezone text default 'America/Argentina/Buenos_Aires',
  p_currency text default 'ARS'
) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_org    uuid;
  v_campus uuid;
  v_user   uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Necesitas una sesion activa para crear una organizacion.';
  end if;

  insert into organizations (name, slug, timezone, default_currency)
  values (p_name, p_slug, p_timezone, p_currency)
  returning id into v_org;

  insert into organization_members (organization_id, user_id, role)
  values (v_org, v_user, 'owner');

  insert into campuses (organization_id, name, slug, default_currency, timezone)
  values (v_org, 'Campus Principal', 'campus-principal', p_currency, p_timezone)
  returning id into v_campus;

  insert into meeting_templates (organization_id, campus_id, label, start_time, sort_order) values
    (v_org, v_campus, 'Reunion 1', '10:30', 10),
    (v_org, v_campus, 'Reunion 2', '12:30', 20),
    (v_org, v_campus, 'Reunion 3', '17:30', 30),
    (v_org, v_campus, 'Reunion 4', '20:00', 40);

  insert into week_concepts (
    organization_id, code, name, allowed_currencies, has_movement_count, kind, sort_order
  )
  select v_org, code, name, allowed_currencies, has_movement_count, kind, sort_order
  from week_concepts where organization_id is null;

  insert into payment_methods (organization_id, name, sort_order) values
    (v_org, 'Efectivo', 10),
    (v_org, 'Transferencia', 20),
    (v_org, 'MercadoPago', 30);

  return v_org;
end;
$fn$;
