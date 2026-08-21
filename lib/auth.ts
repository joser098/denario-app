import 'server-only';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Campus, MemberRole, Organization } from '@/lib/database.types';

export type OrgContext = {
  userId: string;
  email: string;
  organization: Organization;
  role: MemberRole;
  /** Campus asignado al miembro. null = ve todos (owner/admin). */
  campusId: string | null;
  campuses: Campus[];
};

export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect('/login');
  return user;
}

/** Organizaciones del usuario. Vacio = todavia no hizo el onboarding. */
export async function listOrganizations(): Promise<Organization[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('organizations')
    .select('*')
    .eq('is_active', true)
    .order('name');
  return data ?? [];
}

/**
 * Contexto de la organizacion para una pantalla de la app.
 *
 * No es la barrera de seguridad — esa es RLS, que ya rechaza cualquier fila
 * fuera de las organizaciones del usuario. Esto evita repetir la busqueda en
 * cada pagina y da un redirect claro en vez de una pantalla vacia.
 */
export async function requireOrg(slug: string): Promise<OrgContext> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: organization } = await supabase
    .from('organizations')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();

  if (!organization) redirect('/');

  const { data: membership } = await supabase
    .from('organization_members')
    .select('role, campus_id')
    .eq('organization_id', organization.id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!membership) redirect('/');

  const { data: campuses } = await supabase
    .from('campuses')
    .select('*')
    .eq('organization_id', organization.id)
    .eq('is_active', true)
    .order('name');

  const visible = membership.campus_id
    ? (campuses ?? []).filter((c) => c.id === membership.campus_id)
    : (campuses ?? []);

  return {
    userId: user.id,
    email: user.email ?? '',
    organization,
    role: membership.role,
    campusId: membership.campus_id,
    campuses: visible,
  };
}

export function canWrite(role: MemberRole) {
  return role === 'owner' || role === 'admin' || role === 'treasurer';
}

export function canAdmin(role: MemberRole) {
  return role === 'owner' || role === 'admin';
}

export const ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Dueño',
  admin: 'Administrador',
  treasurer: 'Tesorero',
  viewer: 'Solo lectura',
};
