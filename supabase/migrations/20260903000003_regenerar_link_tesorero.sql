-- =============================================================
-- Denario v2 — El tesorero tambien regenera el link de su campus
--
-- El link de pedidos es una herramienta de trabajo de quien maneja la plata
-- del campus: si se filtra, quien tiene que cortarlo es el mismo que atiende
-- los pedidos, no un administrador que capaz no esta.
--
-- No alcanza con cambiar el boton en la pantalla: `campuses_write` es de
-- administradores, y esta bien que lo siga siendo — el nombre, la moneda y
-- el huso del campus no los toca un tesorero. Lo que se abre es solo el
-- token, y por eso va como funcion en vez de como policy: una policy no
-- puede decir "esta columna si y las otras no".
-- =============================================================

-- ---------- Los helpers de permiso nunca devuelven null ----------
-- `org_role(org)` es null para quien no es miembro, asi que `can_write` y
-- `can_admin` devolvian null en vez de false: `null in ('owner', ...)` es
-- null. Dentro de una policy da igual — RLS trata null como false — pero en
-- plpgsql `if not null then` NO entra, asi que cualquier chequeo escrito como
-- `if not can_write(...) then raise` dejaba pasar justo al que no es miembro.
--
-- Ninguna policy cambia de comportamiento con esto: false y null se
-- resuelven igual en `using`. Lo que cambia es que ahora se puede confiar en
-- estas funciones desde codigo imperativo.
create or replace function public.can_write(org uuid)
returns boolean language sql stable as $fn$
  select coalesce(public.org_role(org) in ('owner', 'admin', 'treasurer'), false);
$fn$;

create or replace function public.can_admin(org uuid)
returns boolean language sql stable as $fn$
  select coalesce(public.org_role(org) in ('owner', 'admin'), false);
$fn$;

-- `in_campus` da true para el que no es miembro (siempre va en AND con
-- is_org_member/can_write, que son los que resuelven la pertenencia), asi que
-- estas dos son las que hay que blindar para poder usarlas sueltas.
create or replace function public.can_read_campus(org uuid, campus uuid)
returns boolean language sql stable as $fn$
  select coalesce(public.is_org_member(org) and public.in_campus(org, campus), false);
$fn$;

create or replace function public.can_write_campus(org uuid, campus uuid)
returns boolean language sql stable as $fn$
  select coalesce(public.can_write(org) and public.in_campus(org, campus), false);
$fn$;

-- ---------- Regenerar el link ----------
create or replace function public.regenerate_campus_token(p_campus uuid)
returns text
language plpgsql security definer set search_path = public as $fn$
declare
  v_org   uuid;
  v_token text;
begin
  select c.organization_id into v_org from campuses c where c.id = p_campus;

  -- can_write_campus mira auth.uid(), que security definer no cambia: sigue
  -- siendo quien llama, no el dueño de la funcion.
  if v_org is null or not public.can_write_campus(v_org, p_campus) then
    raise exception 'No podés regenerar el link de ese campus.';
  end if;

  v_token := public.new_request_token();
  update campuses set public_request_token = v_token where id = p_campus;
  return v_token;
end;
$fn$;

revoke all on function public.regenerate_campus_token(uuid) from public;
grant execute on function public.regenerate_campus_token(uuid) to authenticated;

-- ---------- Abrir un domingo ----------
-- Mismo problema: el chequeo miraba solo el campus, y para un no-miembro
-- `in_campus` es true. El INSERT lo frenaba igual la policy de sundays, pero
-- el mensaje salia por el lado equivocado.
create or replace function public.open_sunday(p_campus uuid, p_date date)
returns uuid
language plpgsql as $fn$
declare
  v_org    uuid;
  v_sunday uuid;
begin
  select c.organization_id into v_org from campuses c where c.id = p_campus;
  if v_org is null then
    raise exception 'Ese campus no existe o no lo podés ver.';
  end if;

  if not public.can_write_campus(v_org, p_campus) then
    raise exception 'Ese campus no es el tuyo.';
  end if;

  insert into sundays (organization_id, campus_id, service_date)
  values (v_org, p_campus, p_date)
  returning id into v_sunday;

  insert into sunday_meetings (sunday_id, label, start_time, sort_order)
  select v_sunday, t.label, t.start_time, t.sort_order
  from meeting_templates t
  where t.campus_id = p_campus and t.is_active;

  return v_sunday;
end;
$fn$;
