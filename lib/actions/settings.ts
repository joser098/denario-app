'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { canAdmin, canWrite, requireOrg } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { FormState } from '@/lib/forms';
import { LOGO_BUCKET } from '@/lib/logo';
import { parseAmount } from '@/lib/money';
import { nextOrder, reorder } from '@/lib/order';
import { RESERVED_SLUGS, slugify } from '@/lib/slug';

/**
 * Toda accion de configuracion entra por aca: resuelve la organizacion del
 * slug del formulario y exige rol admin. RLS ya rechaza al que no puede, pero
 * un mensaje claro es mejor que una fila que no aparece.
 */
async function adminContext(formData: FormData) {
  const ctx = await requireOrg(String(formData.get('slug') ?? ''));
  if (!canAdmin(ctx.role)) return null;
  return ctx;
}

const DENIED: FormState = { error: 'No tenés permiso para cambiar la configuración.' };

function fail(error: { message: string; code?: string }): FormState {
  if (error.code === '23505') return { error: 'Ya existe un registro con esos datos.' };
  return { error: error.message };
}

// parseAmount y no un replace a mano: el precio llega con separadores de
// miles, y sacar solo la coma leia "1.000" como 1.
function amount(value: FormDataEntryValue | null): number {
  return parseAmount(value);
}

function direction(formData: FormData): -1 | 1 {
  return formData.get('direction') === 'up' ? -1 : 1;
}

// ============================================================
// Organizacion
// ============================================================

const orgSchema = z.object({
  name: z.string().trim().min(2, 'Poné el nombre de la iglesia.').max(80),
  slug: z
    .string()
    .trim()
    .min(3, 'El identificador necesita al menos 3 caracteres.')
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Usá solo minúsculas, números y guiones.'),
  timezone: z.string().trim().min(1),
  default_currency: z.string().trim().regex(/^[A-Z]{3}$/, 'Elegí una moneda.'),
});

export async function updateOrganization(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await adminContext(formData);
  if (!ctx) return DENIED;

  const parsed = orgSchema.safeParse({
    name: formData.get('name'),
    slug: slugify(String(formData.get('new_slug') || formData.get('name') || '')),
    timezone: formData.get('timezone'),
    default_currency: formData.get('default_currency'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (RESERVED_SLUGS.has(parsed.data.slug)) {
    return { error: `"${parsed.data.slug}" está reservado. Elegí otro identificador.` };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('organizations')
    .update(parsed.data)
    .eq('id', ctx.organization.id);

  if (error) return fail(error);

  revalidatePath(`/${ctx.organization.slug}`, 'layout');

  // El slug es parte de la URL: si cambio, la pantalla actual ya no existe.
  if (parsed.data.slug !== ctx.organization.slug) {
    redirect(`/${parsed.data.slug}/configuracion`);
  }

  return { message: 'Listo, guardamos los cambios.' };
}

/**
 * Solo PNG y JPG: son los unicos formatos que pdf-lib sabe incrustar, y el
 * logo tiene que poder salir tambien en las actas.
 */
const LOGO_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export async function updateOrganizationLogo(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await adminContext(formData);
  if (!ctx) return DENIED;

  const file = formData.get('logo');
  if (!(file instanceof File) || file.size === 0) return { error: 'Elegí un archivo.' };

  const extension = LOGO_TYPES[file.type];
  if (!extension) return { error: 'El logo tiene que ser PNG o JPG.' };
  if (file.size > MAX_LOGO_BYTES) return { error: 'El logo no puede pesar más de 2 MB.' };

  const supabase = await createClient();
  const previous = ctx.organization.logo_path;
  // Nombre nuevo en cada subida: si reusaramos el path, los navegadores
  // seguirian mostrando el logo viejo desde su cache.
  const path = `${ctx.organization.id}/logo-${Date.now()}.${extension}`;

  // Sin upsert: el path lleva timestamp, asi que nunca hay colision. Pedirlo
  // hacia que Storage resolviera el alta como "insert ... on conflict do
  // update", y esa forma exige policy de select sobre storage.objects — que
  // este bucket no tiene, porque se lee por URL publica. Resultado: RLS
  // rechazaba cada subida.
  const { error } = await supabase.storage
    .from(LOGO_BUCKET)
    .upload(path, file, { contentType: file.type });

  if (error) return { error: 'No pudimos subir el logo. Probá de nuevo.' };

  const { error: saveError } = await supabase
    .from('organizations')
    .update({ logo_path: path })
    .eq('id', ctx.organization.id);

  if (saveError) return fail(saveError);

  if (previous && previous !== path) {
    await supabase.storage.from(LOGO_BUCKET).remove([previous]);
  }

  revalidatePath(`/${ctx.organization.slug}`, 'layout');
  return { message: 'Logo actualizado.' };
}

export async function removeOrganizationLogo(formData: FormData) {
  const ctx = await adminContext(formData);
  if (!ctx?.organization.logo_path) return;

  const supabase = await createClient();
  await supabase
    .from('organizations')
    .update({ logo_path: null })
    .eq('id', ctx.organization.id);
  await supabase.storage.from(LOGO_BUCKET).remove([ctx.organization.logo_path]);

  revalidatePath(`/${ctx.organization.slug}`, 'layout');
}

// ============================================================
// Campus
// ============================================================

export async function createCampus(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await adminContext(formData);
  if (!ctx) return DENIED;

  const name = String(formData.get('name') ?? '').trim();
  if (name.length < 2) return { error: 'Poné el nombre del campus.' };

  const supabase = await createClient();
  const { error } = await supabase.from('campuses').insert({
    organization_id: ctx.organization.id,
    name,
    slug: slugify(name),
    default_currency: String(formData.get('default_currency') || ctx.organization.default_currency),
    timezone: (formData.get('timezone') as string) || null,
  });

  if (error) return fail(error);

  revalidatePath(`/${ctx.organization.slug}/configuracion/campus`);
  return { message: `Agregamos ${name}.` };
}

export async function updateCampus(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await adminContext(formData);
  if (!ctx) return DENIED;

  const name = String(formData.get('name') ?? '').trim();
  if (name.length < 2) return { error: 'Poné el nombre del campus.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('campuses')
    .update({ name, default_currency: String(formData.get('default_currency') || 'ARS') })
    .eq('id', String(formData.get('id')))
    .eq('organization_id', ctx.organization.id);

  if (error) return fail(error);

  revalidatePath(`/${ctx.organization.slug}/configuracion/campus`);
  return { message: 'Campus actualizado.' };
}

export async function toggleCampus(formData: FormData) {
  const ctx = await adminContext(formData);
  if (!ctx) return;

  const supabase = await createClient();
  await supabase
    .from('campuses')
    .update({ is_active: formData.get('active') === '1' })
    .eq('id', String(formData.get('id')))
    .eq('organization_id', ctx.organization.id);

  revalidatePath(`/${ctx.organization.slug}/configuracion/campus`);
}

// ============================================================
// Reuniones del domingo (plantilla)
// ============================================================

export async function createMeetingTemplate(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await adminContext(formData);
  if (!ctx) return DENIED;

  const label = String(formData.get('label') ?? '').trim();
  const startTime = String(formData.get('start_time') ?? '');
  if (!label) return { error: 'Poné un nombre para la reunión.' };
  if (!/^\d{2}:\d{2}/.test(startTime)) return { error: 'Poné el horario de la reunión.' };

  const supabase = await createClient();
  const campusId = String(formData.get('campus_id'));

  // Va al final de la lista de ese campus; despues se acomoda con las flechas.
  const { data: siblings } = await supabase
    .from('meeting_templates')
    .select('id, sort_order')
    .eq('campus_id', campusId);

  const { error } = await supabase.from('meeting_templates').insert({
    organization_id: ctx.organization.id,
    campus_id: campusId,
    label,
    start_time: startTime,
    sort_order: nextOrder(siblings ?? []),
  });

  if (error) return fail(error);

  revalidatePath(`/${ctx.organization.slug}/configuracion/reuniones`);
  return { message: `Agregamos ${label}.` };
}

export async function updateMeetingTemplate(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await adminContext(formData);
  if (!ctx) return DENIED;

  const supabase = await createClient();
  const { error } = await supabase
    .from('meeting_templates')
    .update({
      label: String(formData.get('label') ?? '').trim(),
      start_time: String(formData.get('start_time')),
    })
    .eq('id', String(formData.get('id')))
    .eq('organization_id', ctx.organization.id);

  if (error) return fail(error);

  revalidatePath(`/${ctx.organization.slug}/configuracion/reuniones`);
  return { message: 'Reunión actualizada.' };
}

export async function toggleMeetingTemplate(formData: FormData) {
  const ctx = await adminContext(formData);
  if (!ctx) return;

  const supabase = await createClient();
  await supabase
    .from('meeting_templates')
    .update({ is_active: formData.get('active') === '1' })
    .eq('id', String(formData.get('id')))
    .eq('organization_id', ctx.organization.id);

  revalidatePath(`/${ctx.organization.slug}/configuracion/reuniones`);
}

// ============================================================
// Personas: miembros e invitaciones
// ============================================================

const ASSIGNABLE_ROLES = ['admin', 'treasurer', 'viewer'] as const;

export async function inviteMember(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await adminContext(formData);
  if (!ctx) return DENIED;

  const parsed = z
    .object({
      email: z.email('Escribí un email válido.'),
      role: z.enum(ASSIGNABLE_ROLES),
    })
    .safeParse({
      email: String(formData.get('email') ?? '')
        .trim()
        .toLowerCase(),
      role: formData.get('role'),
    });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const campusId = String(formData.get('campus_id') ?? '');

  const supabase = await createClient();
  const { error } = await supabase.from('invitations').insert({
    organization_id: ctx.organization.id,
    email: parsed.data.email,
    role: parsed.data.role,
    campus_id: campusId || null,
    token: randomBytes(24).toString('base64url'),
    invited_by: ctx.userId,
  });

  if (error) return fail(error);

  revalidatePath(`/${ctx.organization.slug}/usuarios`);
  return { message: `Invitación lista para ${parsed.data.email}. Copiá el link y mandáselo.` };
}

export async function revokeInvitation(formData: FormData) {
  const ctx = await adminContext(formData);
  if (!ctx) return;

  const supabase = await createClient();
  await supabase
    .from('invitations')
    .delete()
    .eq('id', String(formData.get('id')))
    .eq('organization_id', ctx.organization.id)
    .is('accepted_at', null);

  revalidatePath(`/${ctx.organization.slug}/usuarios`);
}

export async function updateMember(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await adminContext(formData);
  if (!ctx) return DENIED;

  const memberId = String(formData.get('id'));
  const role = z.enum(ASSIGNABLE_ROLES).safeParse(formData.get('role'));
  if (!role.success) return { error: 'Ese rol no existe.' };

  const supabase = await createClient();
  const { data: target } = await supabase
    .from('organization_members')
    .select('user_id, role')
    .eq('id', memberId)
    .eq('organization_id', ctx.organization.id)
    .maybeSingle();

  if (!target) return { error: 'Esa persona ya no está en la organización.' };
  // El dueño no se toca: sin esta guarda un admin podria degradarlo y dejar
  // la organizacion sin nadie que pueda revertirlo.
  if (target.role === 'owner') return { error: 'Al dueño no se le puede cambiar el rol.' };
  if (target.user_id === ctx.userId) return { error: 'No podés cambiarte el rol a vos mismo.' };

  const campusId = String(formData.get('campus_id') ?? '');
  const { error } = await supabase
    .from('organization_members')
    .update({ role: role.data, campus_id: campusId || null })
    .eq('id', memberId);

  if (error) return fail(error);

  revalidatePath(`/${ctx.organization.slug}/usuarios`);
  return { message: 'Acceso actualizado.' };
}

export async function removeMember(formData: FormData) {
  const ctx = await adminContext(formData);
  if (!ctx) return;

  const supabase = await createClient();
  const { data: target } = await supabase
    .from('organization_members')
    .select('id, user_id, role')
    .eq('id', String(formData.get('id')))
    .eq('organization_id', ctx.organization.id)
    .maybeSingle();

  if (!target || target.role === 'owner' || target.user_id === ctx.userId) return;

  await supabase.from('organization_members').delete().eq('id', target.id);
  revalidatePath(`/${ctx.organization.slug}/usuarios`);
}

// ============================================================
// Productos (ventas del domingo)
// ============================================================

export async function createProduct(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await adminContext(formData);
  if (!ctx) return DENIED;

  const name = String(formData.get('name') ?? '').trim();
  const price = amount(formData.get('price'));
  if (name.length < 2) return { error: 'Poné el nombre del producto.' };
  if (!Number.isFinite(price) || price < 0) return { error: 'El precio tiene que ser un número.' };

  const supabase = await createClient();
  const { data: siblings } = await supabase
    .from('products')
    .select('id, sort_order')
    .eq('organization_id', ctx.organization.id);

  const { error } = await supabase.from('products').insert({
    organization_id: ctx.organization.id,
    name,
    price,
    currency_code: String(formData.get('currency_code') || ctx.organization.default_currency),
    sort_order: nextOrder(siblings ?? []),
  });

  if (error) return fail(error);

  revalidatePath(`/${ctx.organization.slug}/configuracion/productos`);
  return { message: `Agregamos ${name}.` };
}

export async function updateProduct(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await adminContext(formData);
  if (!ctx) return DENIED;

  const price = amount(formData.get('price'));
  if (!Number.isFinite(price) || price < 0) return { error: 'El precio tiene que ser un número.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('products')
    .update({
      name: String(formData.get('name') ?? '').trim(),
      price,
      currency_code: String(formData.get('currency_code') || 'ARS'),
    })
    .eq('id', String(formData.get('id')))
    .eq('organization_id', ctx.organization.id);

  if (error) return fail(error);

  revalidatePath(`/${ctx.organization.slug}/configuracion/productos`);
  return { message: 'Producto actualizado.' };
}

export async function toggleProduct(formData: FormData) {
  const ctx = await adminContext(formData);
  if (!ctx) return;

  const supabase = await createClient();
  await supabase
    .from('products')
    .update({ is_active: formData.get('active') === '1' })
    .eq('id', String(formData.get('id')))
    .eq('organization_id', ctx.organization.id);

  revalidatePath(`/${ctx.organization.slug}/configuracion/productos`);
}

// ============================================================
// Conceptos semanales
// ============================================================

function currencies(formData: FormData): string[] {
  const values = formData.getAll('currencies').map(String).filter(Boolean);
  return values.length ? values : ['ARS'];
}

export async function createWeekConcept(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await adminContext(formData);
  if (!ctx) return DENIED;

  const name = String(formData.get('name') ?? '').trim();
  if (name.length < 2) return { error: 'Poné el nombre del concepto.' };

  const supabase = await createClient();
  const { data: siblings } = await supabase
    .from('week_concepts')
    .select('id, sort_order')
    .eq('organization_id', ctx.organization.id);

  const { error } = await supabase.from('week_concepts').insert({
    organization_id: ctx.organization.id,
    code: slugify(String(formData.get('code') || name)).replace(/-/g, '_'),
    name,
    allowed_currencies: currencies(formData),
    has_movement_count: formData.get('has_movement_count') === 'on',
    // El tipo no se edita despues: cambiarlo daria vuelta el signo de todo
    // lo ya cargado con ese concepto.
    kind: formData.get('kind') === 'expense' ? 'expense' : 'income',
    sort_order: nextOrder(siblings ?? []),
  });

  if (error) return fail(error);

  revalidatePath(`/${ctx.organization.slug}/configuracion/conceptos`);
  return { message: `Agregamos ${name}.` };
}

export async function updateWeekConcept(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await adminContext(formData);
  if (!ctx) return DENIED;

  const supabase = await createClient();
  const { error } = await supabase
    .from('week_concepts')
    .update({
      name: String(formData.get('name') ?? '').trim(),
      allowed_currencies: currencies(formData),
      has_movement_count: formData.get('has_movement_count') === 'on',
    })
    .eq('id', String(formData.get('id')))
    .eq('organization_id', ctx.organization.id);

  if (error) return fail(error);

  revalidatePath(`/${ctx.organization.slug}/configuracion/conceptos`);
  return { message: 'Concepto actualizado.' };
}

export async function toggleWeekConcept(formData: FormData) {
  const ctx = await adminContext(formData);
  if (!ctx) return;

  const supabase = await createClient();
  await supabase
    .from('week_concepts')
    .update({ is_active: formData.get('active') === '1' })
    .eq('id', String(formData.get('id')))
    .eq('organization_id', ctx.organization.id);

  revalidatePath(`/${ctx.organization.slug}/configuracion/conceptos`);
}

// ============================================================
// Orden de las listas
// ============================================================
//
// Tres acciones casi iguales pero con la consulta escrita a mano en cada
// una: `.from(tabla)` con un nombre variable pierde los tipos del esquema,
// y ese es justo el chequeo que evita tocar la tabla equivocada.

export async function moveMeetingTemplate(formData: FormData) {
  const ctx = await adminContext(formData);
  if (!ctx) return;

  const supabase = await createClient();
  const { data: siblings } = await supabase
    .from('meeting_templates')
    .select('id, sort_order')
    .eq('organization_id', ctx.organization.id)
    .eq('campus_id', String(formData.get('campus_id')))
    .order('sort_order');

  for (const row of reorder(siblings ?? [], String(formData.get('id')), direction(formData))) {
    await supabase.from('meeting_templates').update({ sort_order: row.sort_order }).eq('id', row.id);
  }

  revalidatePath(`/${ctx.organization.slug}/configuracion/reuniones`);
}

export async function moveProduct(formData: FormData) {
  const ctx = await adminContext(formData);
  if (!ctx) return;

  const supabase = await createClient();
  const { data: siblings } = await supabase
    .from('products')
    .select('id, sort_order')
    .eq('organization_id', ctx.organization.id)
    .order('sort_order');

  for (const row of reorder(siblings ?? [], String(formData.get('id')), direction(formData))) {
    await supabase.from('products').update({ sort_order: row.sort_order }).eq('id', row.id);
  }

  revalidatePath(`/${ctx.organization.slug}/configuracion/productos`);
}

export async function moveWeekConcept(formData: FormData) {
  const ctx = await adminContext(formData);
  if (!ctx) return;

  const supabase = await createClient();
  const { data: siblings } = await supabase
    .from('week_concepts')
    .select('id, sort_order')
    .eq('organization_id', ctx.organization.id)
    .order('sort_order');

  for (const row of reorder(siblings ?? [], String(formData.get('id')), direction(formData))) {
    await supabase.from('week_concepts').update({ sort_order: row.sort_order }).eq('id', row.id);
  }

  revalidatePath(`/${ctx.organization.slug}/configuracion/conceptos`);
}

// ============================================================
// Equipos y medios de pago
// ============================================================
//
// Dos catalogos con la misma forma: un nombre, activo o no, y un orden.
// Los equipos son quienes piden en Compras; los medios de pago, con que se
// paga un presupuesto.

export async function createTeam(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await adminContext(formData);
  if (!ctx) return DENIED;

  const name = String(formData.get('name') ?? '').trim();
  if (name.length < 2) return { error: 'Poné el nombre del equipo.' };

  const supabase = await createClient();
  const { data: siblings } = await supabase
    .from('teams')
    .select('id, sort_order')
    .eq('organization_id', ctx.organization.id);

  const { error } = await supabase.from('teams').insert({
    organization_id: ctx.organization.id,
    name,
    slug: slugify(name),
    sort_order: nextOrder(siblings ?? []),
  });

  if (error) return fail(error);

  revalidatePath(`/${ctx.organization.slug}/configuracion/equipos`);
  return { message: `Agregamos ${name}.` };
}

export async function updateTeam(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await adminContext(formData);
  if (!ctx) return DENIED;

  const name = String(formData.get('name') ?? '').trim();
  if (name.length < 2) return { error: 'Poné el nombre del equipo.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('teams')
    .update({ name })
    .eq('id', String(formData.get('id')))
    .eq('organization_id', ctx.organization.id);

  if (error) return fail(error);

  revalidatePath(`/${ctx.organization.slug}/configuracion/equipos`);
  return { message: 'Equipo actualizado.' };
}

export async function toggleTeam(formData: FormData) {
  const ctx = await adminContext(formData);
  if (!ctx) return;

  const supabase = await createClient();
  await supabase
    .from('teams')
    .update({ is_active: formData.get('active') === '1' })
    .eq('id', String(formData.get('id')))
    .eq('organization_id', ctx.organization.id);

  revalidatePath(`/${ctx.organization.slug}/configuracion/equipos`);
}

export async function moveTeam(formData: FormData) {
  const ctx = await adminContext(formData);
  if (!ctx) return;

  const supabase = await createClient();
  const { data: siblings } = await supabase
    .from('teams')
    .select('id, sort_order')
    .eq('organization_id', ctx.organization.id)
    .order('sort_order');

  for (const row of reorder(siblings ?? [], String(formData.get('id')), direction(formData))) {
    await supabase.from('teams').update({ sort_order: row.sort_order }).eq('id', row.id);
  }

  revalidatePath(`/${ctx.organization.slug}/configuracion/equipos`);
}

export async function createPaymentMethod(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await adminContext(formData);
  if (!ctx) return DENIED;

  const name = String(formData.get('name') ?? '').trim();
  if (name.length < 2) return { error: 'Poné el nombre del medio de pago.' };

  const supabase = await createClient();
  const { data: siblings } = await supabase
    .from('payment_methods')
    .select('id, sort_order')
    .eq('organization_id', ctx.organization.id);

  const { error } = await supabase.from('payment_methods').insert({
    organization_id: ctx.organization.id,
    name,
    sort_order: nextOrder(siblings ?? []),
  });

  if (error) return fail(error);

  revalidatePath(`/${ctx.organization.slug}/configuracion/medios-de-pago`);
  return { message: `Agregamos ${name}.` };
}

export async function updatePaymentMethod(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await adminContext(formData);
  if (!ctx) return DENIED;

  const name = String(formData.get('name') ?? '').trim();
  if (name.length < 2) return { error: 'Poné el nombre del medio de pago.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('payment_methods')
    .update({ name })
    .eq('id', String(formData.get('id')))
    .eq('organization_id', ctx.organization.id);

  if (error) return fail(error);

  revalidatePath(`/${ctx.organization.slug}/configuracion/medios-de-pago`);
  return { message: 'Medio de pago actualizado.' };
}

export async function togglePaymentMethod(formData: FormData) {
  const ctx = await adminContext(formData);
  if (!ctx) return;

  const supabase = await createClient();
  await supabase
    .from('payment_methods')
    .update({ is_active: formData.get('active') === '1' })
    .eq('id', String(formData.get('id')))
    .eq('organization_id', ctx.organization.id);

  revalidatePath(`/${ctx.organization.slug}/configuracion/medios-de-pago`);
}

export async function movePaymentMethod(formData: FormData) {
  const ctx = await adminContext(formData);
  if (!ctx) return;

  const supabase = await createClient();
  const { data: siblings } = await supabase
    .from('payment_methods')
    .select('id, sort_order')
    .eq('organization_id', ctx.organization.id)
    .order('sort_order');

  for (const row of reorder(siblings ?? [], String(formData.get('id')), direction(formData))) {
    await supabase.from('payment_methods').update({ sort_order: row.sort_order }).eq('id', row.id);
  }

  revalidatePath(`/${ctx.organization.slug}/configuracion/medios-de-pago`);
}

/** Si el link se filtró, se corta y se reparte uno nuevo. */
/**
 * El link de pedidos es de un campus, asi que se regenera de a uno — y lo
 * puede cortar el tesorero de ese campus, no solo un administrador: si se
 * filtro, el que se entera primero es el que atiende los pedidos.
 *
 * Va por RPC y no por un update directo porque `campuses_write` sigue siendo
 * de administradores: lo unico que se abre es el token.
 */
export async function regenerateRequestToken(formData: FormData) {
  const ctx = await requireOrg(String(formData.get('slug') ?? ''));
  if (!canWrite(ctx.role)) return;

  const supabase = await createClient();
  await supabase.rpc('regenerate_campus_token', {
    p_campus: String(formData.get('campus_id')),
  });

  revalidatePath(`/${ctx.organization.slug}/gastos`, 'layout');
}
