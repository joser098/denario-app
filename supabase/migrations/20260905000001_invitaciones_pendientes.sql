-- =============================================================
-- Invitaciones pendientes del usuario de la sesion
-- =============================================================
-- Sin esto, quien entra por primera vez y todavia no acepto la invitacion cae
-- en /nueva-organizacion sin salida: la app le ofrece crear una iglesia cuando
-- en realidad lo esperan en una.
--
-- security definer por la misma razon que accept_invitation: el invitado
-- todavia no es miembro, y la policy invitations_admin solo deja leer a los
-- admin de la organizacion.
--
-- El email NO se toma por parametro: se resuelve contra auth.users a partir de
-- auth.uid(). Recibirlo seria dejar que cualquiera enumere las invitaciones de
-- otro. Sin sesion, auth.uid() es null, el subselect da null y la comparacion
-- no matchea ninguna fila.
create or replace function public.my_pending_invitations()
returns table (token text, organization_name text, role member_role, expires_at timestamptz)
language sql stable security definer set search_path = public as $fn$
  select i.token, o.name, i.role, i.expires_at
  from invitations i
  join organizations o on o.id = i.organization_id
  where i.accepted_at is null
    and i.expires_at > now()
    and o.is_active
    and lower(i.email) = lower((select u.email from auth.users u where u.id = auth.uid()))
  order by i.created_at;
$fn$;

revoke all on function public.my_pending_invitations() from public;
grant execute on function public.my_pending_invitations() to authenticated;
