'use server';

import { revalidatePath } from 'next/cache';
import { canWrite, inCampus, requireOrg, type OrgContext } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { todayIn } from '@/lib/dates';
import { EXPENSE_CONCEPTS, recordWeeklyExpense } from '@/lib/expenses';
import type { FormState } from '@/lib/forms';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Decidir sobre un gasto es de quien maneja la plata de ese campus: owner,
 * admin y el tesorero del campus. Las solicitudes nacen por el link público
 * del campus (ver lib/actions/public-requests.ts); acá se aprueban, rechazan,
 * entregan o pagan, y se registran los pagos en efectivo.
 */
async function writeContext(formData: FormData) {
  const ctx = await requireOrg(String(formData.get('slug') ?? ''));
  if (!canWrite(ctx.role)) return null;
  return ctx;
}

const DENIED: FormState = { error: 'No tenés permiso para decidir sobre los gastos.' };

/** Una solicitud de otro campus no existe para quien está acotado al suyo. */
const NOT_MINE: FormState = { error: 'Esa solicitud no existe.' };

function money(value: FormDataEntryValue | null): number {
  return Number(String(value ?? '').replace(/\./g, '').replace(',', '.'));
}

function expensesPath(slug: string) {
  return `/${slug}/gastos`;
}

/**
 * La moneda del campus. Es el default de todo monto de Gastos: el de la
 * organizacion serviria mientras todos los campus cobraran lo mismo.
 */
async function campusCurrency(supabase: Supabase, campusId: string, fallback: string) {
  const { data } = await supabase
    .from('campuses')
    .select('default_currency')
    .eq('id', campusId)
    .maybeSingle();

  return data?.default_currency ?? fallback;
}

/** El campus del formulario tiene que ser uno que el miembro pueda tocar. */
function ownCampus(ctx: OrgContext, formData: FormData): string | null {
  const campusId = String(formData.get('campus_id') ?? '') || ctx.campusId;
  if (!campusId || !inCampus(ctx, campusId)) return null;
  return campusId;
}

// ============================================================
// Compras
// ============================================================

export async function approvePurchase(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writeContext(formData);
  if (!ctx) return DENIED;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('purchase_requests')
    .update({ status: 'approved', decided_by: ctx.userId, decided_at: new Date().toISOString() })
    .eq('id', String(formData.get('id')))
    .eq('organization_id', ctx.organization.id)
    .eq('status', 'pending')
    .select('id');

  if (error) return { error: error.message };
  if (!data?.length) return NOT_MINE;

  revalidatePath(expensesPath(ctx.organization.slug));
  return { message: 'Pedido aprobado. Cuando se compre, cargá el monto real.' };
}

export async function rejectPurchase(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writeContext(formData);
  if (!ctx) return DENIED;

  const reason = String(formData.get('rejection_reason') ?? '').trim();
  if (reason.length < 5) return { error: 'Escribí por qué se rechaza el pedido.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('purchase_requests')
    .update({
      status: 'rejected',
      rejection_reason: reason,
      decided_by: ctx.userId,
      decided_at: new Date().toISOString(),
    })
    .eq('id', String(formData.get('id')))
    .eq('organization_id', ctx.organization.id)
    .eq('status', 'pending')
    .select('id');

  if (error) return { error: error.message };
  if (!data?.length) return NOT_MINE;

  revalidatePath(expensesPath(ctx.organization.slug));
  return { message: 'Pedido rechazado.' };
}

export async function deliverPurchase(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writeContext(formData);
  if (!ctx) return DENIED;

  const amount = money(formData.get('actual_amount'));
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Poné cuánto salió en realidad.' };

  const id = String(formData.get('id'));

  const supabase = await createClient();
  const { data: request } = await supabase
    .from('purchase_requests')
    .select('id, status, campus_id, requester_name')
    .eq('id', id)
    .eq('organization_id', ctx.organization.id)
    .maybeSingle();

  if (!request || !inCampus(ctx, request.campus_id)) return NOT_MINE;
  if (request.status !== 'approved') {
    return { error: 'Solo se puede entregar un pedido aprobado.' };
  }

  const currency = String(
    formData.get('actual_currency') ||
      (await campusCurrency(supabase, request.campus_id, ctx.organization.default_currency)),
  );

  // Primero el gasto: si la semana está cerrada, el pedido no cambia de
  // estado y el problema se ve enseguida.
  const recorded = await recordWeeklyExpense(supabase, {
    organizationId: ctx.organization.id,
    campusId: request.campus_id,
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
// Pagos y transferencias
// ============================================================

/**
 * Aprobar no mueve plata: deja el pedido autorizado para que alguien lo
 * pague despues. Ese corte es todo el punto — quien autoriza y quien
 * transfiere no siempre son la misma persona, ni el mismo dia.
 */
export async function approvePaymentRequest(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await writeContext(formData);
  if (!ctx) return DENIED;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('payment_requests')
    .update({ status: 'approved', decided_by: ctx.userId, decided_at: new Date().toISOString() })
    .eq('id', String(formData.get('id')))
    .eq('organization_id', ctx.organization.id)
    .eq('status', 'pending')
    .select('id');

  if (error) return { error: error.message };
  if (!data?.length) return NOT_MINE;

  revalidatePath(`${expensesPath(ctx.organization.slug)}/pagos`);
  return { message: 'Pedido aprobado. Cuando se pague, cargá el monto real.' };
}

export async function rejectPaymentRequest(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await writeContext(formData);
  if (!ctx) return DENIED;

  const reason = String(formData.get('rejection_reason') ?? '').trim();
  if (reason.length < 5) return { error: 'Escribí por qué se rechaza el pedido.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('payment_requests')
    .update({
      status: 'rejected',
      rejection_reason: reason,
      decided_by: ctx.userId,
      decided_at: new Date().toISOString(),
    })
    .eq('id', String(formData.get('id')))
    .eq('organization_id', ctx.organization.id)
    .eq('status', 'pending')
    .select('id');

  if (error) return { error: error.message };
  if (!data?.length) return NOT_MINE;

  revalidatePath(`${expensesPath(ctx.organization.slug)}/pagos`);
  return { message: 'Pedido rechazado.' };
}

/** Segundo paso: la plata sale, y recien ahi cae el egreso en el semanal. */
export async function payPaymentRequest(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await writeContext(formData);
  if (!ctx) return DENIED;

  const amount = money(formData.get('actual_amount'));
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Poné cuánto se pagó.' };

  const paymentMethodId = String(formData.get('payment_method_id') ?? '');
  if (!paymentMethodId) return { error: 'Elegí con qué se pagó.' };

  const id = String(formData.get('id'));

  const supabase = await createClient();
  const { data: request } = await supabase
    .from('payment_requests')
    .select('id, status, campus_id, description')
    .eq('id', id)
    .eq('organization_id', ctx.organization.id)
    .maybeSingle();

  if (!request || !inCampus(ctx, request.campus_id)) return NOT_MINE;
  if (request.status !== 'approved') {
    return { error: 'Solo se puede pagar un pedido aprobado.' };
  }

  const currency = String(
    formData.get('actual_currency') ||
      (await campusCurrency(supabase, request.campus_id, ctx.organization.default_currency)),
  );

  const recorded = await recordWeeklyExpense(supabase, {
    organizationId: ctx.organization.id,
    campusId: request.campus_id,
    conceptCode: EXPENSE_CONCEPTS.payment,
    amount,
    currency,
    date: todayIn(ctx.organization.timezone),
    sourceType: 'payment_request',
    sourceId: id,
    description: `Pago — ${request.description}`,
  });

  if (recorded.error) return { error: recorded.error };

  const { error } = await supabase
    .from('payment_requests')
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

  revalidatePath(`${expensesPath(ctx.organization.slug)}/pagos`, 'layout');
  return { message: 'Pagado. El gasto quedó cargado en el libro semanal.' };
}

// ============================================================
// Presupuestos
// ============================================================

/**
 * Un presupuesto es documentación: no mueve plata. Cuando se decide pagarlo,
 * este es el puente — nace la solicitud de pago con los datos ya cargados y
 * las dos filas quedan enlazadas, así que después se puede ver de qué
 * presupuesto salió cada pago.
 */
export async function requestBudgetPayment(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await writeContext(formData);
  if (!ctx) return DENIED;

  const id = String(formData.get('id'));
  const supabase = await createClient();

  const { data: budget } = await supabase
    .from('budgets')
    .select('*')
    .eq('id', id)
    .eq('organization_id', ctx.organization.id)
    .maybeSingle();

  if (!budget || !inCampus(ctx, budget.campus_id)) return { error: 'Ese presupuesto no existe.' };
  if (budget.payment_request_id) {
    return { error: 'Este presupuesto ya tiene una solicitud de pago.' };
  }

  const { data: created, error } = await supabase
    .from('payment_requests')
    .insert({
      organization_id: budget.organization_id,
      campus_id: budget.campus_id,
      team_id: budget.team_id,
      requester_name: budget.requester_name,
      requester_email: budget.requester_email,
      requester_phone: budget.requester_phone,
      description: budget.description,
      estimated_amount: budget.estimated_amount,
      estimated_currency: budget.estimated_currency,
    })
    .select('id')
    .single();

  if (error || !created) return { error: 'No se pudo generar la solicitud de pago.' };

  const { error: linkError } = await supabase
    .from('budgets')
    .update({ payment_request_id: created.id })
    .eq('id', id);

  if (linkError) return { error: linkError.message };

  revalidatePath(expensesPath(ctx.organization.slug), 'layout');
  return { message: 'Solicitud de pago generada. Está pendiente en Pagos y transferencias.' };
}

export async function deleteBudget(formData: FormData) {
  const ctx = await writeContext(formData);
  if (!ctx) return;

  const supabase = await createClient();
  await supabase
    .from('budgets')
    .delete()
    .eq('id', String(formData.get('id')))
    .eq('organization_id', ctx.organization.id)
    // Un presupuesto del que ya salió un pago es el respaldo de ese pago:
    // borrarlo dejaría el pago sin de dónde salió.
    .is('payment_request_id', null);

  revalidatePath(`${expensesPath(ctx.organization.slug)}/presupuestos`);
}

// ============================================================
// Pagos en efectivo
// ============================================================

/**
 * Registro interno de un pago de caja. No hay solicitud ni aprobación: la
 * plata ya se entregó y lo que queda es documentarla. El recibo con el
 * número correlativo sale de acá y lo firma el acreedor.
 */
export async function registerCashPayment(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await writeContext(formData);
  if (!ctx) return DENIED;

  const campusId = ownCampus(ctx, formData);
  if (!campusId) return { error: 'Elegí el campus.' };

  const payee = String(formData.get('payee_name') ?? '').trim();
  if (!payee) return { error: 'Poné a nombre de quién sale el recibo.' };

  const concept = String(formData.get('concept') ?? '').trim();
  if (concept.length < 3) return { error: 'Escribí en concepto de qué se paga.' };

  const amount = money(formData.get('amount'));
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Poné cuánto se pagó.' };

  const supabase = await createClient();
  const currency = String(
    formData.get('currency_code') ||
      (await campusCurrency(supabase, campusId, ctx.organization.default_currency)),
  );
  const paidOn = String(formData.get('paid_on') ?? '') || todayIn(ctx.organization.timezone);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) return { error: 'Elegí la fecha del pago.' };

  const teamId = String(formData.get('team_id') ?? '') || null;

  const { data: created, error } = await supabase
    .from('cash_payments')
    .insert({
      organization_id: ctx.organization.id,
      campus_id: campusId,
      payee_name: payee,
      payee_document: String(formData.get('payee_document') ?? '').trim() || null,
      concept,
      team_id: teamId,
      amount,
      currency_code: currency,
      paid_on: paidOn,
      notes: String(formData.get('notes') ?? '').trim() || null,
      created_by: ctx.userId,
    })
    .select('id, receipt_number')
    .single();

  if (error || !created) return { error: error?.message ?? 'No se pudo registrar el pago.' };

  // El egreso va después del registro: si la semana está cerrada, el pago ya
  // quedó documentado y solo falta el asiento — deshacerlo sería peor.
  const recorded = await recordWeeklyExpense(supabase, {
    organizationId: ctx.organization.id,
    campusId,
    conceptCode: EXPENSE_CONCEPTS.cash,
    amount,
    currency,
    date: paidOn,
    sourceType: 'cash_payment',
    sourceId: created.id,
    description: `Pago en efectivo — ${payee}`,
  });

  revalidatePath(`${expensesPath(ctx.organization.slug)}/efectivo`, 'layout');

  if (recorded.error) {
    return {
      message: `Recibo N° ${created.receipt_number} generado, pero el gasto no entró al libro semanal: ${recorded.error}`,
    };
  }

  return {
    message: `Recibo N° ${created.receipt_number} generado. El gasto quedó cargado en el libro semanal.`,
  };
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
  const ctx = await writeContext(formData);
  if (!ctx) return DENIED;

  const campusId = ownCampus(ctx, formData);
  if (!campusId) return NOT_MINE;

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
    campus_id: campusId,
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
