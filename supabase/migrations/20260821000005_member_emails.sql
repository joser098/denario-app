-- =============================================================
-- Denario v2 — Listado de miembros con email
--
-- organization_members guarda solo user_id; el email vive en auth.users,
-- que ninguna policy de public puede leer. Este RPC es la unica puerta:
-- security definer, pero solo devuelve filas si quien pregunta ya es
-- miembro de esa organizacion (lo mismo que ya permite members_read).
-- =============================================================

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
    and public.is_org_member(p_org)
  order by m.created_at;
$fn$;

revoke all on function public.org_members_with_email(uuid) from public;
grant execute on function public.org_members_with_email(uuid) to authenticated;
