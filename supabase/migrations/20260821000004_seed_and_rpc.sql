-- =============================================================
-- Denario v2 — Semillas del sistema, RPCs de bootstrap y storage
-- =============================================================

-- ---------- Monedas ----------
insert into currencies (code, name, symbol) values
  ('ARS', 'Peso argentino', '$'),
  ('USD', 'Dolar estadounidense', 'US$');

-- ---------- Denominaciones (billetes en circulacion) ----------
insert into currency_denominations (currency_code, value)
select 'ARS', v from unnest(array[20000, 10000, 2000, 1000, 500, 200, 100, 50, 20, 10]::numeric[]) v;

insert into currency_denominations (currency_code, value)
select 'USD', v from unnest(array[100, 50, 20, 10, 5, 2, 1]::numeric[]) v;

-- ---------- Conceptos semanales (plantilla del sistema) ----------
insert into week_concepts (organization_id, code, name, allowed_currencies, has_movement_count, sort_order) values
  (null, 'efectivo',            'Efectivo',            array['ARS','USD'], false, 10),
  (null, 'mercadopago',         'MercadoPago',         array['ARS'],       false, 20),
  (null, 'transferencia_macro', 'Transferencias Macro', array['ARS','USD'], false, 30),
  -- monto total + cuantos movimientos lo componen
  (null, 'transacciones',       'Transacciones',       array['ARS','USD'], true,  40),
  -- ventas, cursos, entradas a eventos
  (null, 'actividad_comercial', 'Actividad comercial', array['ARS','USD'], false, 50);

-- ---------- Bucket de actas (privado, se sirve con signed URLs) ----------
insert into storage.buckets (id, name, public)
values ('actas', 'actas', false)
on conflict (id) do nothing;

-- ---------- Crear organizacion (onboarding) ----------
-- security definer porque en el momento del insert el usuario todavia no es
-- miembro de nada, asi que ninguna policy lo dejaria pasar.
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

  -- Las 4 reuniones de hoy. Son editables: cambian horario y cantidad.
  insert into meeting_templates (organization_id, campus_id, label, start_time, sort_order) values
    (v_org, v_campus, 'Reunion 1', '10:30', 10),
    (v_org, v_campus, 'Reunion 2', '12:30', 20),
    (v_org, v_campus, 'Reunion 3', '17:30', 30),
    (v_org, v_campus, 'Reunion 4', '20:00', 40);

  -- Clonar los conceptos semanales de la plantilla del sistema.
  insert into week_concepts (organization_id, code, name, allowed_currencies, has_movement_count, sort_order)
  select v_org, code, name, allowed_currencies, has_movement_count, sort_order
  from week_concepts where organization_id is null;

  return v_org;
end;
$fn$;

revoke all on function public.create_organization(text, text, text, text) from public;
grant execute on function public.create_organization(text, text, text, text) to authenticated;

-- ---------- Aceptar invitacion ----------
-- Tambien security definer: el invitado no es miembro todavia, no puede leer
-- la invitacion ni insertarse en organization_members por policy.
create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_inv   invitations%rowtype;
  v_user  uuid := auth.uid();
  v_email text;
begin
  if v_user is null then
    raise exception 'Necesitas una sesion activa para aceptar la invitacion.';
  end if;

  select email into v_email from auth.users where id = v_user;
  select * into v_inv from invitations where token = p_token;

  if v_inv.id is null then
    raise exception 'Invitacion inexistente.';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'Esta invitacion ya fue usada.';
  end if;
  if v_inv.expires_at < now() then
    raise exception 'Esta invitacion vencio.';
  end if;
  if lower(v_inv.email) <> lower(v_email) then
    raise exception 'La invitacion es para %, no para %.', v_inv.email, v_email;
  end if;

  insert into organization_members (organization_id, user_id, campus_id, role, invited_by)
  values (v_inv.organization_id, v_user, v_inv.campus_id, v_inv.role, v_inv.invited_by)
  on conflict (organization_id, user_id) do nothing;

  update invitations set accepted_at = now() where id = v_inv.id;

  return v_inv.organization_id;
end;
$fn$;

revoke all on function public.accept_invitation(text) from public;
grant execute on function public.accept_invitation(text) to authenticated;

-- Datos de la invitacion para la pantalla de aceptacion (accesible sin sesion:
-- la posesion del token es la autorizacion).
create or replace function public.invitation_preview(p_token text)
returns table (organization_name text, email text, role member_role, expires_at timestamptz, accepted boolean)
language sql security definer set search_path = public as $fn$
  select o.name, i.email, i.role, i.expires_at, i.accepted_at is not null
  from invitations i join organizations o on o.id = i.organization_id
  where i.token = p_token;
$fn$;

revoke all on function public.invitation_preview(text) from public;
grant execute on function public.invitation_preview(text) to anon, authenticated;
