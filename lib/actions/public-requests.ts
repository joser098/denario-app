'use server';

import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import type { FormState } from '@/lib/forms';

/**
 * Alta pública de solicitudes de Compras y Presupuestos (`/p/<token>`).
 *
 * Quien pide no tiene cuenta en la app: es el encargado de un ministerio
 * mandando un pedido. Tener el link de la organización es la autorización,
 * así que corre con service-role y se valida a mano lo que haría RLS —
 * mismo patrón que el conteo y la caja de ventas.
 */

type Client = ReturnType<typeof createAdminClient>;

async function findOrganization(supabase: Client, token: string) {
  if (!token) return null;

  const { data } = await supabase
    .from('organizations')
    .select('id, name, default_currency')
    .eq('public_request_token', token)
    .eq('is_active', true)
    .maybeSingle();

  return data;
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
  const token = String(formData.get('org_token') ?? '');
  const supabase = createAdminClient();

  const organization = await findOrganization(supabase, token);
  if (!organization) return { error: 'Este link no corresponde a ninguna iglesia.' };

  const person = requester(formData);
  if (!person.requester_name) return { error: 'Poné tu nombre.' };

  const team = await findTeam(supabase, organization.id, String(formData.get('team_id') ?? ''));
  if (!team) return { error: 'Elegí el equipo que hace el pedido.' };

  const items = parseItems(formData);
  if (items.length === 0) return { error: 'Cargá al menos un ítem con su cantidad.' };

  const estimated = money(formData.get('estimated_amount'));

  const { data: created, error } = await supabase
    .from('purchase_requests')
    .insert({
      organization_id: organization.id,
      team_id: team.id,
      ...person,
      estimated_amount: Number.isFinite(estimated) && estimated > 0 ? estimated : null,
      estimated_currency: String(formData.get('estimated_currency') || organization.default_currency),
    })
    .select('id, public_token')
    .single();

  if (error || !created) return { error: 'No pudimos enviar el pedido. Probá de nuevo.' };

  const { error: itemsError } = await supabase
    .from('purchase_request_items')
    .insert(items.map((item) => ({ ...item, purchase_request_id: created.id })));

  if (itemsError) {
    // Un pedido sin ítems no dice nada: mejor que no exista.
    await supabase.from('purchase_requests').delete().eq('id', created.id);
    return { error: 'No pudimos enviar el pedido. Probá de nuevo.' };
  }

  redirect(`/s/${created.public_token}`);
}

// ============================================================
// Presupuestos
// ============================================================

export async function submitBudgetRequest(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const token = String(formData.get('org_token') ?? '');
  const supabase = createAdminClient();

  const organization = await findOrganization(supabase, token);
  if (!organization) return { error: 'Este link no corresponde a ninguna iglesia.' };

  const person = requester(formData);
  if (!person.requester_name) return { error: 'Poné tu nombre.' };

  const description = String(formData.get('description') ?? '').trim();
  if (description.length < 5) return { error: 'Contá para qué es el presupuesto.' };

  const estimated = money(formData.get('estimated_amount'));
  if (!Number.isFinite(estimated) || estimated <= 0) return { error: 'Poné el monto estimado.' };

  // El equipo es opcional: un presupuesto puede no salir de ningún ministerio.
  const teamId = String(formData.get('team_id') ?? '');
  const team = teamId ? await findTeam(supabase, organization.id, teamId) : null;
  if (teamId && !team) return { error: 'Ese equipo no existe.' };

  const { data: created, error } = await supabase
    .from('budget_requests')
    .insert({
      organization_id: organization.id,
      team_id: team?.id ?? null,
      ...person,
      description,
      estimated_amount: estimated,
      estimated_currency: String(formData.get('estimated_currency') || organization.default_currency),
    })
    .select('id, public_token')
    .single();

  if (error || !created) return { error: 'No pudimos enviar el pedido. Probá de nuevo.' };

  // Cotización o presupuesto adjunto, si lo trajo. Que falle no invalida el
  // pedido: la solicitud ya está cargada.
  const file = formData.get('file');
  if (file instanceof File && file.size > 0 && file.size <= 10 * 1024 * 1024) {
    const extension = file.name.split('.').pop()?.toLowerCase() ?? 'bin';
    const path = `${organization.id}/budget_request/${created.id}/${Date.now()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from('adjuntos')
      .upload(path, file, { contentType: file.type });

    if (!uploadError) {
      await supabase.from('attachments').insert({
        organization_id: organization.id,
        attachable_type: 'budget_request',
        attachable_id: created.id,
        kind: 'quote',
        storage_path: path,
        original_filename: file.name,
        content_type: file.type,
      });
    }
  }

  redirect(`/s/${created.public_token}`);
}
