import 'server-only';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Campus, MemberRole, Organization } from '@/lib/database.types';

export type OrgContext = {
  userId: string;
  email: string;
  organization: Organization;
  role: MemberRole;
  /**
   * Campus al que esta acotado el miembro. null = ve toda la organizacion.
   *
   * Owner y admin siempre son null, aunque tengan un campus asignado: el
   * campus acota a quien carga, no a quien administra. Espejo exacto de
   * public.member_campus() en la base — si cambia uno tiene que cambiar el
   * otro, porque la pantalla y RLS tienen que decir lo mismo.
   */
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

  const campusId = canAdmin(membership.role) ? null : membership.campus_id;

  const visible = campusId
    ? (campuses ?? []).filter((c) => c.id === campusId)
    : (campuses ?? []);

  return {
    userId: user.id,
    email: user.email ?? '',
    organization,
    role: membership.role,
    campusId,
    campuses: visible,
  };
}

/**
 * Igual que requireOrg pero ademas exige rol de admin.
 *
 * Tiene que estar en la pagina, no solo en el layout: en App Router el layout
 * y la pagina se renderizan en paralelo, asi que un redirect en el layout no
 * frena a la pagina y su markup termina viajando igual en la respuesta. El
 * guard del layout se queda (decide las pestañas), pero el que corta es este.
 */
export async function requireAdminOrg(slug: string): Promise<OrgContext> {
  const ctx = await requireOrg(slug);
  if (!canAdmin(ctx.role)) redirect(`/${slug}`);
  return ctx;
}

/**
 * Si el miembro puede tocar algo de ese campus. Un `null` es una fila que no
 * es de ningun campus: la ve solo quien no esta acotado a uno.
 *
 * RLS ya rechaza lo demas; esto convierte el rechazo en un mensaje.
 */
export function inCampus(ctx: OrgContext, campusId: string | null) {
  return ctx.campusId === null || ctx.campusId === campusId;
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
