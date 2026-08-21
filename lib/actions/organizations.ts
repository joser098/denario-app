'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type { FormState } from '@/lib/forms';
import { RESERVED_SLUGS, slugify } from '@/lib/slug';

const schema = z.object({
  name: z.string().trim().min(2, 'Poné el nombre de la iglesia.').max(80),
  slug: z
    .string()
    .trim()
    .min(3, 'El identificador necesita al menos 3 caracteres.')
    .max(40)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Usá solo minúsculas, números y guiones.'),
  timezone: z.string().trim().min(1),
  currency: z.enum(['ARS', 'USD']),
});

export async function createOrganization(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const name = String(formData.get('name') ?? '');
  const parsed = schema.safeParse({
    name,
    slug: slugify(String(formData.get('slug') || name)),
    timezone: formData.get('timezone') || 'America/Argentina/Buenos_Aires',
    currency: formData.get('currency') || 'ARS',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  if (RESERVED_SLUGS.has(parsed.data.slug)) {
    return { error: `"${parsed.data.slug}" está reservado. Elegí otro identificador.` };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('create_organization', {
    p_name: parsed.data.name,
    p_slug: parsed.data.slug,
    p_timezone: parsed.data.timezone,
    p_currency: parsed.data.currency,
  });

  if (error) {
    if (error.code === '23505') {
      return { error: 'Ya existe una organización con ese identificador.' };
    }
    return { error: error.message };
  }

  redirect(`/${parsed.data.slug}`);
}

export async function acceptInvitation(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const token = String(formData.get('token') ?? '');
  if (!token) return { error: 'Falta el token de la invitación.' };

  const supabase = await createClient();
  const { data: orgId, error } = await supabase.rpc('accept_invitation', { p_token: token });

  if (error) return { error: error.message };

  const { data: org } = await supabase
    .from('organizations')
    .select('slug')
    .eq('id', orgId as string)
    .maybeSingle();

  redirect(org ? `/${org.slug}` : '/');
}
