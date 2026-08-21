'use server';

import { revalidatePath } from 'next/cache';
import { canAdmin, requireOrg } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { todayIn } from '@/lib/dates';
import { EXPENSE_CONCEPTS, recordWeeklyExpense } from '@/lib/expenses';
import type { FormState } from '@/lib/forms';

/**
 * Decidir sobre una solicitud es de administradores. Las solicitudes nacen
 * por el link público (ver lib/actions/public-requests.ts); acá solo se
 * aprueban, rechazan, entregan o pagan.
 */
async function decider(formData: FormData) {
  const ctx = await requireOrg(String(formData.get('slug') ?? ''));
  if (!canAdmin(ctx.role)) return null;
  return ctx;
}

const DENIED: FormState = { error: 'Solo un administrador decide sobre las solicitudes.' };

function money(value: FormDataEntryValue | null): number {
  return Number(String(value ?? '').replace(/\./g, '').replace(',', '.'));
}

function expensesPath(slug: string) {
  return `/${slug}/gastos`;
}

// ============================================================
// Compras
// ============================================================

export async function approvePurchase(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await decider(formData);
  if (!ctx) return DENIED;

  const supabase = await createClient();
  const { error } = await supabase
    .from('purchase_requests')
    .update({ status: 'approved', decided_by: ctx.userId, decided_at: new Date().toISOString() })
    .eq('id', String(formData.get('id')))
    .eq('organization_id', ctx.organization.id)
    .eq('status', 'pending');

  if (error) return { error: error.message };

  revalidatePath(expensesPath(ctx.organization.slug));
  return { message: 'Pedido aprobado. Cuando se compre, cargá el monto real.' };
}

export async function rejectPurchase(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await decider(formData);
  if (!ctx) return DENIED;

  const reason = String(formData.get('rejection_reason') ?? '').trim();
  if (reason.length < 5) return { error: 'Escribí por qué se rechaza el pedido.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('purchase_requests')
    .update({
      status: 'rejected',
      rejection_reason: reason,
      decided_by: ctx.userId,
      decided_at: new Date().toISOString(),
    })
    .eq('id', String(formData.get('id')))
    .eq('organization_id', ctx.organization.id)
    .eq('status', 'pending');

  if (error) return { error: error.message };

  revalidatePath(expensesPath(ctx.organization.slug));
  return { message: 'Pedido rechazado.' };
}

export async function deliverPurchase(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await decider(formData);
  if (!ctx) return DENIED;

  const amount = money(formData.get('actual_amount'));
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Poné cuánto salió en realidad.' };

  const currency = String(formData.get('actual_currency') || ctx.organization.default_currency);
  const id = String(formData.get('id'));

  const supabase = await createClient();
  const { data: request } = await supabase
    .from('purchase_requests')
    .select('id, status, requester_name')
    .eq('id', id)
    .eq('organization_id', ctx.organization.id)
    .maybeSingle();

  if (!request) return { error: 'Ese pedido no existe.' };
  if (request.status !== 'approved') {
    return { error: 'Solo se puede entregar un pedido aprobado.' };
  }

  // Primero el gasto: si la semana está cerrada, el pedido no cambia de
  // estado y el problema se ve enseguida.
  const recorded = await recordWeeklyExpense(supabase, {
    organizationId: ctx.organization.id,
    conceptCode: EXPENSE_CONCEPTS.purchase,
    amount,
    currency,
    date: todayIn(ctx.organization.timezone),
    sourceType: 'purchase_request',
    sourceId: id,
    description: `Compra — ${request.requester_name}`,
  });

  if (recorded.error) return { error: recorded.error };

  const { error } = await supabase
    .from('purchase_requests')
    .update({
      status: 'delivered',
      actual_amount: amount,
      actual_currency: currency,
      delivered_by: ctx.userId,
      delivered_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) return { error: error.message };

  revalidatePath(expensesPath(ctx.organization.slug), 'layout');
  return { message: 'Entregado. El gasto quedó cargado en el libro semanal.' };
}

// ============================================================
// Presupuestos
// ============================================================

export async function rejectBudget(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await decider(formData);
  if (!ctx) return DENIED;

  const reason = String(formData.get('rejection_reason') ?? '').trim();
  if (reason.length < 5) return { error: 'Escribí por qué se rechaza el presupuesto.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('budget_requests')
    .update({
      status: 'rejected',
      rejection_reason: reason,
      decided_by: ctx.userId,
      decided_at: new Date().toISOString(),
    })
    .eq('id', String(formData.get('id')))
    .eq('organization_id', ctx.organization.id)
    .eq('status', 'pending');

  if (error) return { error: error.message };

  revalidatePath(`${expensesPath(ctx.organization.slug)}/presupuestos`);
  return { message: 'Presupuesto rechazado.' };
}

/** Aprobar y pagar son un solo paso: se paga o no se paga. */
export async function payBudget(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await decider(formData);
  if (!ctx) return DENIED;

  const amount = money(formData.get('actual_amount'));
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Poné cuánto se pagó.' };

  const paymentMethodId = String(formData.get('payment_method_id') ?? '');
  if (!paymentMethodId) return { error: 'Elegí con qué se pagó.' };

  const currency = String(formData.get('actual_currency') || ctx.organization.default_currency);
  const id = String(formData.get('id'));

  const supabase = await createClient();
  const { data: request } = await supabase
    .from('budget_requests')
    .select('id, status, requester_name, description')
    .eq('id', id)
    .eq('organization_id', ctx.organization.id)
    .maybeSingle();

  if (!request) return { error: 'Ese presupuesto no existe.' };
  if (request.status !== 'pending') return { error: 'Ese presupuesto ya fue decidido.' };

  const recorded = await recordWeeklyExpense(supabase, {
    organizationId: ctx.organization.id,
    conceptCode: EXPENSE_CONCEPTS.budget,
    amount,
    currency,
    date: todayIn(ctx.organization.timezone),
    sourceType: 'budget_request',
    sourceId: id,
    description: `Presupuesto — ${request.description}`,
  });

  if (recorded.error) return { error: recorded.error };

  const { error } = await supabase
    .from('budget_requests')
    .update({
      status: 'paid',
      payment_method_id: paymentMethodId,
      actual_amount: amount,
      actual_currency: currency,
      decided_by: ctx.userId,
      decided_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) return { error: error.message };

  revalidatePath(`${expensesPath(ctx.organization.slug)}/presupuestos`, 'layout');
  return { message: 'Pagado. El gasto quedó cargado en el libro semanal.' };
}

// ============================================================
// Comprobantes
// ============================================================

const ATTACHMENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'application/pdf',
]);

/** Se adjunta después de cerrar, sin bloquear nada. */
export async function attachReceipt(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await decider(formData);
  if (!ctx) return DENIED;

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Elegí un archivo.' };
  if (!ATTACHMENT_TYPES.has(file.type)) return { error: 'Tiene que ser PDF, PNG o JPG.' };
  if (file.size > 10 * 1024 * 1024) return { error: 'El archivo no puede pesar más de 10 MB.' };

  const attachableType = String(formData.get('attachable_type'));
  const attachableId = String(formData.get('attachable_id'));
  const extension = file.name.split('.').pop()?.toLowerCase() ?? 'bin';
  const path = `${ctx.organization.id}/${attachableType}/${attachableId}/${Date.now()}.${extension}`;

  const supabase = await createClient();
  const { error } = await supabase.storage
    .from('adjuntos')
    .upload(path, file, { contentType: file.type });

  if (error) return { error: 'No pudimos subir el archivo. Probá de nuevo.' };

  const { error: saveError } = await supabase.from('attachments').insert({
    organization_id: ctx.organization.id,
    attachable_type: attachableType,
    attachable_id: attachableId,
    kind: 'receipt',
    storage_path: path,
    original_filename: file.name,
    content_type: file.type,
    uploaded_by: ctx.userId,
  });

  if (saveError) return { error: saveError.message };

  revalidatePath(expensesPath(ctx.organization.slug), 'layout');
  return { message: 'Comprobante adjuntado.' };
}
