-- =============================================================
-- org_members_with_email: solo para quien administra
-- =============================================================
-- Filtraba por is_org_member, asi que cualquier tesorero o lector podia
-- listar por API los emails de todos los miembros, aunque la pantalla
-- Usuarios sea solo de admins. La funcion y la pantalla tienen que decir lo
-- mismo: es la unica consumidora, y ya exige admin.
create or replace function public.org_members_with_email(p_org uuid)
returns table (
  id         uuid,
  user_id    uuid,
  email      text,
  role       member_role,
  campus_id  uuid,
  created_at timestamptz
)
language sql stable security definer set search_path = public as $fn$
  select m.id, m.user_id, u.email::text, m.role, m.campus_id, m.created_at
  from organization_members m
  join auth.users u on u.id = m.user_id
  where m.organization_id = p_org
    and public.can_admin(p_org)
  order by m.created_at;
$fn$;

revoke all on function public.org_members_with_email(uuid) from public;
grant execute on function public.org_members_with_email(uuid) to authenticated;
