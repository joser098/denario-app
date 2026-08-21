'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { attachCashboxActa } from '@/lib/pdf/actas';
import type { FormState } from '@/lib/forms';

/**
 * Caja de ventas desde el link publico (`/v/<publicId>`).
 *
 * Mismo criterio que el conteo: el vendedor no tiene sesion y la
 * autorizacion es tener el link, asi que todo se busca por sales_public_id
 * con el cliente service-role y se valida a mano lo que haria RLS.
 */

type Client = ReturnType<typeof createAdminClient>;

/** La reunion del link, si existe y admite movimientos. */
async function openMeeting(supabase: Client, publicId: string) {
  const { data: meeting } = await supabase
    .from('sunday_meetings')
    .select('id, status, sundays!inner(status)')
    .eq('sales_public_id', publicId)
    .maybeSingle();

  if (!meeting) return { error: 'Este link no corresponde a ninguna reunión.' } as const;

  const sunday = meeting.sundays as unknown as { status: string };
  if (meeting.status === 'locked' || sunday.status === 'closed') {
    return { error: 'Esta reunión ya está cerrada. Avisale a la tesorería.' } as const;
  }

  return { meeting } as const;
}

/** La caja abierta de esa reunion. */
async function openCashbox(supabase: Client, publicId: string) {
  const check = await openMeeting(supabase, publicId);
  if ('error' in check) return { error: check.error } as const;

  const { data: session } = await supabase
    .from('meeting_sales_sessions')
    .select('id, status')
    .eq('meeting_id', check.meeting.id)
    .maybeSingle();

  if (!session) return { error: 'Todavía no hay una caja abierta.' } as const;
  if (session.status === 'closed') return { error: 'La caja ya está cerrada.' } as const;

  return { session, meeting: check.meeting } as const;
}

// ============================================================
// Abrir y cerrar
// ============================================================

export async function startCashbox(_prev: FormState, formData: FormData): Promise<FormState> {
  const publicId = String(formData.get('public_id') ?? '').trim();
  const seller = String(formData.get('seller_name') ?? '').trim();
  if (!seller) return { error: 'Poné tu nombre para abrir la caja.' };

  const supabase = createAdminClient();
  const check = await openMeeting(supabase, publicId);
  if ('error' in check) return { error: check.error };

  const { error } = await supabase
    .from('meeting_sales_sessions')
    .insert({ meeting_id: check.meeting.id, seller_name: seller });

  if (error) {
    if (error.code === '23505') return { error: 'Esta reunión ya tiene una caja abierta.' };
    return { error: 'No pudimos abrir la caja. Probá de nuevo.' };
  }

  revalidatePath(`/v/${publicId}`);
  return { message: `Caja abierta a nombre de ${seller}.` };
}

export async function closeCashbox(_prev: FormState, formData: FormData): Promise<FormState> {
  const publicId = String(formData.get('public_id') ?? '').trim();

  const supabase = createAdminClient();
  const check = await openCashbox(supabase, publicId);
  if ('error' in check) return { error: check.error };

  const { error } = await supabase
    .from('meeting_sales_sessions')
    .update({
      status: 'closed',
      closed_at: new Date().toISOString(),
      witness_name: String(formData.get('witness_name') ?? '').trim() || null,
      notes: String(formData.get('notes') ?? '').trim() || null,
    })
    .eq('id', check.session.id);

  if (error) return { error: 'No pudimos cerrar la caja. Probá de nuevo.' };

  await attachCashboxActa(supabase, check.session.id);

  revalidatePath(`/v/${publicId}`);
  return { message: 'Caja cerrada. Ya no se pueden cargar más ventas.' };
}

// ============================================================
// Ventas
// ============================================================

export async function addPublicSale(_prev: FormState, formData: FormData): Promise<FormState> {
  const publicId = String(formData.get('public_id') ?? '').trim();

  const supabase = createAdminClient();
  const check = await openCashbox(supabase, publicId);
  if ('error' in check) return { error: check.error };

  const quantity = Math.trunc(Number(formData.get('quantity') ?? 0));
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { error: 'La cantidad tiene que ser 1 o más.' };
  }

  const method = String(formData.get('payment_method'));
  if (method !== 'cash' && method !== 'mercadopago') return { error: 'Elegí cómo te pagaron.' };

  // El producto tiene que ser de la misma organizacion que la reunion: sin
  // esto, un link valido podria usarse para cargar productos de otra iglesia.
  const { data: product } = await supabase
    .from('products')
    .select('id, name, price, currency_code, organization_id')
    .eq('id', String(formData.get('product_id')))
    .eq('is_active', true)
    .maybeSingle();

  const { data: meetingOrg } = await supabase
    .from('sunday_meetings')
    .select('sundays!inner(organization_id)')
    .eq('id', check.meeting.id)
    .maybeSingle();

  const organizationId = (meetingOrg?.sundays as unknown as { organization_id: string } | undefined)
    ?.organization_id;

  if (!product || product.organization_id !== organizationId) {
    return { error: 'Ese producto no existe.' };
  }

  const { data: sale, error } = await supabase
    .from('sales')
    .insert({
      meeting_id: check.meeting.id,
      session_id: check.session.id,
      payment_method: method,
      currency_code: product.currency_code,
      seller_name: null,
    })
    .select('id')
    .single();

  if (error || !sale) return { error: 'No pudimos registrar la venta. Probá de nuevo.' };

  const { error: lineError } = await supabase.from('sale_lines').insert({
    sale_id: sale.id,
    product_id: product.id,
    product_name: product.name,
    quantity,
    unit_price: product.price,
  });

  if (lineError) {
    await supabase.from('sales').delete().eq('id', sale.id);
    return { error: 'No pudimos registrar la venta. Probá de nuevo.' };
  }

  revalidatePath(`/v/${publicId}`);
  return { message: `${quantity} × ${product.name}.` };
}

export async function removePublicSale(formData: FormData) {
  const publicId = String(formData.get('public_id') ?? '').trim();

  const supabase = createAdminClient();
  const check = await openCashbox(supabase, publicId);
  if ('error' in check) return;

  // Solo puede borrar ventas de su propia caja.
  await supabase
    .from('sales')
    .delete()
    .eq('id', String(formData.get('id')))
    .eq('session_id', check.session.id);

  revalidatePath(`/v/${publicId}`);
}
