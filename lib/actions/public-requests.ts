'use server';

import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import type { FormState } from '@/lib/forms';

/**
 * Alta pública de lo que entra por el link del campus (`/p/<token>`):
 * compras, presupuestos y pagos o transferencias.
 *
 * Quien pide no tiene cuenta en la app: es el encargado de un ministerio
 * mandando un pedido. Tener el link del campus es la autorización, así que
 * corre con service-role y se valida a mano lo que haría RLS — mismo patrón
 * que el conteo y la caja de ventas.
 *
 * El campus sale del link, nunca del formulario: un link es de un campus y
 * de uno solo, así que quien pide no elige (ni puede equivocarse).
 */

type Client = ReturnType<typeof createAdminClient>;

export type PublicCampus = {
  id: string;
  organizationId: string;
  defaultCurrency: string;
};

async function findCampus(supabase: Client, token: string): Promise<PublicCampus | null> {
  if (!token) return null;

  const { data } = await supabase
    .from('campuses')
    .select('id, organization_id, default_currency, organizations!inner(is_active)')
    .eq('public_request_token', token)
    .eq('is_active', true)
    .maybeSingle();

  if (!data) return null;

  const organization = data.organizations as unknown as { is_active: boolean };
  if (!organization.is_active) return null;

  return {
    id: data.id,
    organizationId: data.organization_id,
    defaultCurrency: data.default_currency,
  };
}

/** El equipo tiene que ser de esta organización, no de otra. */
async function findTeam(supabase: Client, organizationId: string, teamId: string) {
  if (!teamId) return null;

  const { data } = await supabase
    .from('teams')
    .select('id')
    .eq('id', teamId)
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .maybeSingle();

  return data;
}

function money(value: FormDataEntryValue | null): number {
  return Number(String(value ?? '').replace(/\./g, '').replace(',', '.'));
}

function requester(formData: FormData) {
  return {
    requester_name: String(formData.get('requester_name') ?? '').trim(),
    requester_email: String(formData.get('requester_email') ?? '').trim() || null,
    requester_phone: String(formData.get('requester_phone') ?? '').trim() || null,
  };
}

const BAD_LINK: FormState = { error: 'Este link no corresponde a ningún campus.' };
const FAILED: FormState = { error: 'No pudimos enviar el pedido. Probá de nuevo.' };

/**
 * Cotización o presupuesto adjunto, si lo trajo. Que falle no invalida el
 * pedido: la solicitud ya está cargada.
 */
async function attachQuote(
  supabase: Client,
  file: FormDataEntryValue | null,
  target: { organizationId: string; campusId: string; type: string; id: string },
) {
  if (!(file instanceof File) || file.size === 0 || file.size > 10 * 1024 * 1024) return;

  const extension = file.name.split('.').pop()?.toLowerCase() ?? 'bin';
  const path = `${target.organizationId}/${target.type}/${target.id}/${Date.now()}.${extension}`;

  const { error } = await supabase.storage
    .from('adjuntos')
    .upload(path, file, { contentType: file.type });

  if (error) return;

  await supabase.from('attachments').insert({
    organization_id: target.organizationId,
    campus_id: target.campusId,
    attachable_type: target.type,
    attachable_id: target.id,
    kind: 'quote',
    storage_path: path,
    original_filename: file.name,
    content_type: file.type,
  });
}

// ============================================================
// Compras
// ============================================================

/**
 * Los ítems viajan como campos repetidos del formulario: `item_name`,
 * `item_quantity` y `item_unit` en el mismo orden. Así el formulario suma
 * filas sin inventar un JSON escondido en un input.
 */
function parseItems(formData: FormData) {
  const names = formData.getAll('item_name').map(String);
  const quantities = formData.getAll('item_quantity').map(String);
  const units = formData.getAll('item_unit').map(String);

  return names
    .map((name, index) => ({
      name: name.trim(),
      quantity: Number(quantities[index] ?? 0),
      unit: (units[index] ?? '').trim() || null,
    }))
    .filter((item) => item.name && Number.isFinite(item.quantity) && item.quantity > 0);
}

export async function submitPurchaseRequest(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const supabase = createAdminClient();
  const campus = await findCampus(supabase, String(formData.get('campus_token') ?? ''));
  if (!campus) return BAD_LINK;

  const person = requester(formData);
  if (!person.requester_name) return { error: 'Poné tu nombre.' };

  const team = await findTeam(supabase, campus.organizationId, String(formData.get('team_id') ?? ''));
  if (!team) return { error: 'Elegí el equipo que hace el pedido.' };

  const items = parseItems(formData);
  if (items.length === 0) return { error: 'Cargá al menos un ítem con su cantidad.' };

  const estimated = money(formData.get('estimated_amount'));

  const { data: created, error } = await supabase
    .from('purchase_requests')
    .insert({
      organization_id: campus.organizationId,
      campus_id: campus.id,
      team_id: team.id,
      ...person,
      estimated_amount: Number.isFinite(estimated) && estimated > 0 ? estimated : null,
      estimated_currency: String(formData.get('estimated_currency') || campus.defaultCurrency),
    })
    .select('id, public_token')
    .single();

  if (error || !created) return FAILED;

  const { error: itemsError } = await supabase
    .from('purchase_request_items')
    .insert(items.map((item) => ({ ...item, purchase_request_id: created.id })));

  if (itemsError) {
    // Un pedido sin ítems no dice nada: mejor que no exista.
    await supabase.from('purchase_requests').delete().eq('id', created.id);
    return FAILED;
  }

  redirect(`/s/${created.public_token}`);
}

// ============================================================
// Presupuestos
// ============================================================

/**
 * Un presupuesto presentado. No arranca ningún flujo: queda documentado y
 * listo, y si hay que pagarlo la tesorería genera la solicitud de pago
 * desde la app.
 */
export async function submitBudget(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = createAdminClient();
  const campus = await findCampus(supabase, String(formData.get('campus_token') ?? ''));
  if (!campus) return BAD_LINK;

  const person = requester(formData);
  if (!person.requester_name) return { error: 'Poné tu nombre.' };

  const description = String(formData.get('description') ?? '').trim();
  if (description.length < 5) return { error: 'Contá de qué es el presupuesto.' };

  const estimated = money(formData.get('estimated_amount'));
  if (!Number.isFinite(estimated) || estimated <= 0) return { error: 'Poné el monto del presupuesto.' };

  // El equipo es opcional: un presupuesto puede no salir de ningún ministerio.
  const teamId = String(formData.get('team_id') ?? '');
  const team = teamId ? await findTeam(supabase, campus.organizationId, teamId) : null;
  if (teamId && !team) return { error: 'Ese equipo no existe.' };

  const { data: created, error } = await supabase
    .from('budgets')
    .insert({
      organization_id: campus.organizationId,
      campus_id: campus.id,
      team_id: team?.id ?? null,
      ...person,
      description,
      estimated_amount: estimated,
      estimated_currency: String(formData.get('estimated_currency') || campus.defaultCurrency),
    })
    .select('id, public_token')
    .single();

  if (error || !created) return FAILED;

  await attachQuote(supabase, formData.get('file'), {
    organizationId: campus.organizationId,
    campusId: campus.id,
    type: 'budget',
    id: created.id,
  });

  redirect(`/s/${created.public_token}`);
}

// ============================================================
// Pagos y transferencias
// ============================================================

export async function submitPaymentRequest(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const supabase = createAdminClient();
  const campus = await findCampus(supabase, String(formData.get('campus_token') ?? ''));
  if (!campus) return BAD_LINK;

  const person = requester(formData);
  if (!person.requester_name) return { error: 'Poné tu nombre.' };

  const description = String(formData.get('description') ?? '').trim();
  if (description.length < 5) return { error: 'Contá para qué es el pago.' };

  const estimated = money(formData.get('estimated_amount'));
  if (!Number.isFinite(estimated) || estimated <= 0) return { error: 'Poné el monto a pagar.' };

  const teamId = String(formData.get('team_id') ?? '');
  const team = teamId ? await findTeam(supabase, campus.organizationId, teamId) : null;
  if (teamId && !team) return { error: 'Ese equipo no existe.' };

  const { data: created, error } = await supabase
    .from('payment_requests')
    .insert({
      organization_id: campus.organizationId,
      campus_id: campus.id,
      team_id: team?.id ?? null,
      ...person,
      description,
      estimated_amount: estimated,
      estimated_currency: String(formData.get('estimated_currency') || campus.defaultCurrency),
    })
    .select('id, public_token')
    .single();

  if (error || !created) return FAILED;

  await attachQuote(supabase, formData.get('file'), {
    organizationId: campus.organizationId,
    campusId: campus.id,
    type: 'payment_request',
    id: created.id,
  });

  redirect(`/s/${created.public_token}`);
}
