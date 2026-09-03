'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { canAdmin, canWrite, inCampus, requireOrg, type OrgContext } from '@/lib/auth';
import { parseAmount } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { parseCountLines } from '@/lib/count-lines';
import { campusCurrencies, listDenominations } from '@/lib/currencies';
import { attachCountActa, attachSundayActa } from '@/lib/pdf/actas';
import type { FormState } from '@/lib/forms';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Toda accion del modulo entra por aca: resuelve la organizacion del slug del
 * formulario y exige rol de carga. RLS ya rechaza al que no puede; esto da un
 * mensaje en vez de una fila que no cambia.
 */
async function writeContext(formData: FormData) {
  const ctx = await requireOrg(String(formData.get('slug') ?? ''));
  if (!canWrite(ctx.role)) return null;
  return ctx;
}

const DENIED: FormState = { error: 'No tenés permiso para cargar movimientos.' };

/** Un domingo de otro campus no existe para quien esta acotado al suyo. */
const NOT_MINE: FormState = { error: 'Ese domingo no existe.' };

function fail(error: { message: string; code?: string }): FormState {
  if (error.code === '23505') return { error: 'Ya existe un registro para eso.' };
  return { error: error.message };
}


function meetingPath(ctx: OrgContext, sundayId: string, meetingId: string) {
  return `/${ctx.organization.slug}/domingos/${sundayId}/reuniones/${meetingId}`;
}

/**
 * La reunion tiene que existir, ser de esta organizacion y de un campus que
 * el miembro pueda tocar, y estar abierta.
 */
async function openMeeting(supabase: Supabase, ctx: OrgContext, meetingId: string) {
  const { data } = await supabase
    .from('sunday_meetings')
    .select(
      'id, sunday_id, status, sundays!inner(organization_id, campus_id, status, campuses!inner(default_currency))',
    )
    .eq('id', meetingId)
    .maybeSingle();

  if (!data) return { error: 'Esa reunión no existe.' } as const;

  const sunday = data.sundays as unknown as {
    organization_id: string;
    campus_id: string;
    status: string;
    campuses: { default_currency: string };
  };
  if (sunday.organization_id !== ctx.organization.id || !inCampus(ctx, sunday.campus_id)) {
    return { error: 'Esa reunión no existe.' } as const;
  }
  if (sunday.status === 'closed' || data.status === 'locked') {
    return { error: 'El domingo está cerrado. Reabrilo para poder cargar.' } as const;
  }

  return { meeting: data, campusCurrency: sunday.campuses.default_currency } as const;
}

/** El domingo tiene que existir, ser de esta organizacion y del campus propio. */
async function ownSunday(supabase: Supabase, ctx: OrgContext, sundayId: string) {
  const { data } = await supabase
    .from('sundays')
    .select('id, status, campus_id')
    .eq('id', sundayId)
    .eq('organization_id', ctx.organization.id)
    .maybeSingle();

  if (!data || !inCampus(ctx, data.campus_id)) return null;
  return data;
}

/** El acta tiene que colgar de un domingo de esta organizacion y del campus propio. */
async function ownCount(supabase: Supabase, ctx: OrgContext, countId: string) {
  const { data } = await supabase
    .from('offering_counts')
    .select('id, meeting_id, sunday_meetings!inner(sunday_id)')
    .eq('id', countId)
    .maybeSingle();

  if (!data) return null;

  const { sunday_id: sundayId } = data.sunday_meetings as unknown as { sunday_id: string };
  return (await ownSunday(supabase, ctx, sundayId)) ? { ...data, sundayId } : null;
}

// ============================================================
// El domingo
// ============================================================

export async function openSunday(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writeContext(formData);
  if (!ctx) return DENIED;

  const campusId = String(formData.get('campus_id') ?? '');
  const date = String(formData.get('service_date') ?? '');
  if (!campusId) return { error: 'Elegí el campus.' };
  if (!inCampus(ctx, campusId)) return { error: 'Ese campus no es el tuyo.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Elegí la fecha del domingo.' };

  const supabase = await createClient();
  const { data: sundayId, error } = await supabase.rpc('open_sunday', {
    p_campus: campusId,
    p_date: date,
  });

  if (error) {
    if (error.code === '23505') return { error: 'Ese domingo ya está abierto para ese campus.' };
    return fail(error);
  }

  revalidatePath(`/${ctx.organization.slug}/domingos`);
  redirect(`/${ctx.organization.slug}/domingos/${sundayId}`);
}

export async function updateSundayNotes(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await writeContext(formData);
  if (!ctx) return DENIED;

  const sundayId = String(formData.get('sunday_id'));
  const supabase = await createClient();

  const sunday = await ownSunday(supabase, ctx, sundayId);

  if (!sunday) return NOT_MINE;
  if (sunday.status === 'closed') {
    return { error: 'El domingo está cerrado. Reabrilo para poder editarlo.' };
  }

  const { error } = await supabase
    .from('sundays')
    .update({ notes: String(formData.get('notes') ?? '').trim() || null })
    .eq('id', sundayId)
    .eq('organization_id', ctx.organization.id);

  if (error) return fail(error);

  revalidatePath(`/${ctx.organization.slug}/domingos/${sundayId}`);
  return { message: 'Notas guardadas.' };
}

export async function closeSunday(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writeContext(formData);
  if (!ctx) return DENIED;

  const sundayId = String(formData.get('sunday_id'));
  const supabase = await createClient();
  if (!(await ownSunday(supabase, ctx, sundayId))) return NOT_MINE;

  // Un domingo cerrado con actas a medio hacer no cierra nada: esas actas ya
  // no se van a poder tocar y el total del domingo queda mintiendo.
  const { data: drafts } = await supabase
    .from('offering_counts')
    .select('id, sunday_meetings!inner(sunday_id)')
    .eq('status', 'draft')
    .eq('sunday_meetings.sunday_id', sundayId);

  if (drafts && drafts.length > 0) {
    return {
      error: `Hay ${drafts.length} acta(s) en borrador. Finalizalas o anulalas antes de cerrar.`,
    };
  }

  const { error } = await supabase
    .from('sundays')
    .update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: ctx.userId })
    .eq('id', sundayId)
    .eq('organization_id', ctx.organization.id);

  if (error) return fail(error);

  await supabase.from('sunday_meetings').update({ status: 'locked' }).eq('sunday_id', sundayId);
  await attachSundayActa(supabase, sundayId, { closedBy: ctx.email });

  revalidatePath(`/${ctx.organization.slug}/domingos`, 'layout');
  return { message: 'Domingo cerrado.' };
}

export async function reopenSunday(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writeContext(formData);
  if (!ctx) return DENIED;
  // Reabrir deshace un cierre firmado: queda para administradores.
  if (!canAdmin(ctx.role)) {
    return { error: 'Solo un administrador puede reabrir un domingo cerrado.' };
  }

  const sundayId = String(formData.get('sunday_id'));
  const supabase = await createClient();
  if (!(await ownSunday(supabase, ctx, sundayId))) return NOT_MINE;

  const { error } = await supabase
    .from('sundays')
    .update({ status: 'draft', closed_at: null, closed_by: null })
    .eq('id', sundayId)
    .eq('organization_id', ctx.organization.id);

  if (error) return fail(error);

  await supabase.from('sunday_meetings').update({ status: 'open' }).eq('sunday_id', sundayId);

  revalidatePath(`/${ctx.organization.slug}/domingos`, 'layout');
  return { message: 'Domingo reabierto.' };
}

// ============================================================
// Acta de conteo
// ============================================================

/**
 * Abre un acta en borrador para cargarla desde la app.
 *
 * Hoy ninguna pantalla la ofrece: el conteo entra unicamente por el link
 * publico. Queda disponible por si vuelve a hacer falta contar desde el
 * escritorio; el editor de borrador sigue funcionando.
 */
export async function startCount(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writeContext(formData);
  if (!ctx) return DENIED;

  const meetingId = String(formData.get('meeting_id'));
  const supabase = await createClient();
  const check = await openMeeting(supabase, ctx, meetingId);
  if ('error' in check) return { error: check.error };

  const { error } = await supabase.from('offering_counts').insert({
    meeting_id: meetingId,
    supersedes_id: (formData.get('supersedes_id') as string) || null,
  });

  if (error) {
    if (error.code === '23505') return { error: 'Esta reunión ya tiene un acta vigente.' };
    return fail(error);
  }

  revalidatePath(meetingPath(ctx, check.meeting.sunday_id, meetingId));
  return { message: 'Acta iniciada.' };
}

/** Cabecera + lineas del borrador. Devuelve el total contado por moneda. */
async function persistDraft(
  supabase: Supabase,
  countId: string,
  campusCurrency: string,
  formData: FormData,
) {
  // Acotado al campus, igual que la planilla: parseCountLines descarta lo que
  // no este en esta lista, asi que es lo que impide guardar un billete de una
  // moneda que ese campus no maneja.
  const denominations = await listDenominations(supabase, campusCurrencies(campusCurrency));

  const lines = parseCountLines(formData, denominations);

  const { error: headerError } = await supabase
    .from('offering_counts')
    .update({
      volunteer_name: String(formData.get('volunteer_name') ?? '').trim() || null,
      witness_1_name: String(formData.get('witness_1_name') ?? '').trim() || null,
      witness_2_name: String(formData.get('witness_2_name') ?? '').trim() || null,
      envelopes_count: Math.max(0, Math.trunc(Number(formData.get('envelopes_count') ?? 0)) || 0),
      notes: String(formData.get('notes') ?? '').trim() || null,
    })
    .eq('id', countId);

  if (headerError) return { error: headerError };

  // Reemplazo completo: es mas simple y mas seguro que reconciliar fila por
  // fila, y el trigger ya impide hacerlo sobre un acta que no sea borrador.
  const { error: deleteError } = await supabase
    .from('offering_count_lines')
    .delete()
    .eq('offering_count_id', countId);

  if (deleteError) return { error: deleteError };

  if (lines.length > 0) {
    const { error: insertError } = await supabase
      .from('offering_count_lines')
      .insert(lines.map((line) => ({ ...line, offering_count_id: countId })));

    if (insertError) return { error: insertError };
  }

  return { lines };
}

async function loadDraft(supabase: Supabase, ctx: OrgContext, countId: string) {
  const { data } = await supabase
    .from('offering_counts')
    .select('id, status, meeting_id, sunday_meetings!inner(sunday_id)')
    .eq('id', countId)
    .maybeSingle();

  if (!data) return { error: 'Ese acta no existe.' } as const;
  if (data.status !== 'draft') return { error: 'El acta ya no es un borrador.' } as const;

  const check = await openMeeting(supabase, ctx, data.meeting_id);
  if ('error' in check) return { error: check.error } as const;

  return {
    count: data,
    sundayId: check.meeting.sunday_id,
    campusCurrency: check.campusCurrency,
  } as const;
}

export async function saveCount(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writeContext(formData);
  if (!ctx) return DENIED;

  const supabase = await createClient();
  const countId = String(formData.get('count_id'));
  const draft = await loadDraft(supabase, ctx, countId);
  if ('error' in draft) return { error: draft.error };

  const result = await persistDraft(supabase, countId, draft.campusCurrency, formData);
  if (result.error) return fail(result.error);

  revalidatePath(meetingPath(ctx, draft.sundayId, draft.count.meeting_id));
  return { message: 'Borrador guardado.' };
}

export async function finalizeCount(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writeContext(formData);
  if (!ctx) return DENIED;

  const supabase = await createClient();
  const countId = String(formData.get('count_id'));
  const draft = await loadDraft(supabase, ctx, countId);
  if ('error' in draft) return { error: draft.error };

  // Un acta es un documento firmado: sin nombres no hay a quien preguntarle.
  if (!String(formData.get('volunteer_name') ?? '').trim()) {
    return { error: 'Poné el nombre de quien contó.' };
  }
  if (!String(formData.get('witness_1_name') ?? '').trim()) {
    return { error: 'Poné al menos un testigo.' };
  }

  const result = await persistDraft(supabase, countId, draft.campusCurrency, formData);
  if (result.error) return fail(result.error);

  const { error } = await supabase
    .from('offering_counts')
    .update({ status: 'finalized', finalized_at: new Date().toISOString() })
    .eq('id', countId);

  if (error) return fail(error);

  const pdf = await attachCountActa(supabase, countId);

  revalidatePath(meetingPath(ctx, draft.sundayId, draft.count.meeting_id));
  return {
    message: pdf
      ? 'Acta finalizada. A partir de ahora no se puede editar.'
      : 'Acta finalizada, pero no pudimos generar el PDF. Volvé a entrar más tarde.',
  };
}

/**
 * El formulario del acta tiene dos botones; el que se apreto llega como
 * `intent`. Un solo action para no duplicar los campos en dos formularios.
 */
export async function submitCount(_prev: FormState, formData: FormData): Promise<FormState> {
  return formData.get('intent') === 'finalize'
    ? finalizeCount(_prev, formData)
    : saveCount(_prev, formData);
}

export async function voidCount(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writeContext(formData);
  if (!ctx) return DENIED;

  const reason = String(formData.get('voided_reason') ?? '').trim();
  if (reason.length < 5) return { error: 'Escribí por qué se anula el acta.' };

  const meetingId = String(formData.get('meeting_id'));
  const supabase = await createClient();
  const check = await openMeeting(supabase, ctx, meetingId);
  if ('error' in check) return { error: check.error };

  const { error } = await supabase
    .from('offering_counts')
    .update({ status: 'voided', voided_reason: reason })
    .eq('id', String(formData.get('count_id')))
    .eq('meeting_id', meetingId);

  if (error) return fail(error);

  revalidatePath(meetingPath(ctx, check.meeting.sunday_id, meetingId));
  return { message: 'Acta anulada. Podés cargar una nueva.' };
}

// ============================================================
// Ventas
// ============================================================

export async function addSale(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writeContext(formData);
  if (!ctx) return DENIED;

  const meetingId = String(formData.get('meeting_id'));
  const supabase = await createClient();
  const check = await openMeeting(supabase, ctx, meetingId);
  if ('error' in check) return { error: check.error };

  const quantity = Math.trunc(Number(formData.get('quantity') ?? 0));
  if (!Number.isFinite(quantity) || quantity <= 0) return { error: 'La cantidad tiene que ser 1 o más.' };

  const method = String(formData.get('payment_method'));
  if (method !== 'cash' && method !== 'mercadopago') return { error: 'Elegí el medio de pago.' };

  const { data: product } = await supabase
    .from('products')
    .select('id, name, price, currency_code')
    .eq('id', String(formData.get('product_id')))
    .eq('organization_id', ctx.organization.id)
    .maybeSingle();

  if (!product) return { error: 'Ese producto no existe.' };

  const { data: sale, error } = await supabase
    .from('sales')
    .insert({
      meeting_id: meetingId,
      payment_method: method,
      currency_code: product.currency_code,
      seller_name: String(formData.get('seller_name') ?? '').trim() || null,
    })
    .select('id')
    .single();

  if (error) return fail(error);
  if (!sale) return { error: 'No se pudo registrar la venta.' };

  // Nombre y precio quedan copiados: si mañana cambia el producto, la venta
  // sigue diciendo lo que se cobro ese domingo.
  const { error: lineError } = await supabase.from('sale_lines').insert({
    sale_id: sale.id,
    product_id: product.id,
    product_name: product.name,
    quantity,
    unit_price: product.price,
  });

  if (lineError) {
    await supabase.from('sales').delete().eq('id', sale.id);
    return fail(lineError);
  }

  revalidatePath(meetingPath(ctx, check.meeting.sunday_id, meetingId));
  return { message: `Venta registrada: ${quantity} × ${product.name}.` };
}

export async function deleteSale(formData: FormData) {
  const ctx = await writeContext(formData);
  if (!ctx) return;

  const meetingId = String(formData.get('meeting_id'));
  const supabase = await createClient();
  const check = await openMeeting(supabase, ctx, meetingId);
  if ('error' in check) return;

  await supabase
    .from('sales')
    .delete()
    .eq('id', String(formData.get('id')))
    .eq('meeting_id', meetingId);

  revalidatePath(meetingPath(ctx, check.meeting.sunday_id, meetingId));
}

// ============================================================
// Ingresos digitales (MercadoPago)
// ============================================================

export async function addIncome(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writeContext(formData);
  if (!ctx) return DENIED;

  const meetingId = String(formData.get('meeting_id'));
  const supabase = await createClient();
  const check = await openMeeting(supabase, ctx, meetingId);
  if ('error' in check) return { error: check.error };

  const amount = parseAmount(formData.get('amount'));
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Poné un monto mayor a cero.' };

  const { error } = await supabase.from('meeting_incomes').insert({
    meeting_id: meetingId,
    concept: 'mercadopago',
    currency_code: String(formData.get('currency_code') || check.campusCurrency),
    amount,
    reference: String(formData.get('reference') ?? '').trim() || null,
    created_by_name: String(formData.get('created_by_name') ?? '').trim() || null,
  });

  if (error) return fail(error);

  revalidatePath(meetingPath(ctx, check.meeting.sunday_id, meetingId));
  return { message: 'Ingreso registrado.' };
}

export async function deleteIncome(formData: FormData) {
  const ctx = await writeContext(formData);
  if (!ctx) return;

  const meetingId = String(formData.get('meeting_id'));
  const supabase = await createClient();
  const check = await openMeeting(supabase, ctx, meetingId);
  if ('error' in check) return;

  await supabase
    .from('meeting_incomes')
    .delete()
    .eq('id', String(formData.get('id')))
    .eq('meeting_id', meetingId);

  revalidatePath(meetingPath(ctx, check.meeting.sunday_id, meetingId));
}

// ============================================================
// Regenerar PDFs
// ============================================================

/**
 * El PDF es una representacion del acta, no el acta. Si la generacion falla
 * (storage caido, por ejemplo) la fila ya quedo firmada igual, asi que hace
 * falta una forma de volver a intentarlo. Se permite incluso con el domingo
 * cerrado: esto no toca ningun numero.
 */
export async function generateCountActa(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await writeContext(formData);
  if (!ctx) return DENIED;

  const supabase = await createClient();
  const countId = String(formData.get('count_id'));
  if (!(await ownCount(supabase, ctx, countId))) return { error: 'Ese acta no existe.' };

  const ok = await attachCountActa(supabase, countId);
  if (!ok) return { error: 'No pudimos generar el PDF. Probá de nuevo en un rato.' };

  revalidatePath(
    meetingPath(ctx, String(formData.get('sunday_id')), String(formData.get('meeting_id'))),
  );
  return { message: 'PDF generado.' };
}

export async function generateSundayActa(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await writeContext(formData);
  if (!ctx) return DENIED;

  const sundayId = String(formData.get('sunday_id'));
  const supabase = await createClient();
  if (!(await ownSunday(supabase, ctx, sundayId))) return NOT_MINE;

  const ok = await attachSundayActa(supabase, sundayId, { closedBy: ctx.email });
  if (!ok) return { error: 'No pudimos generar el PDF. Probá de nuevo en un rato.' };

  revalidatePath(`/${ctx.organization.slug}/domingos/${sundayId}`);
  return { message: 'PDF generado.' };
}
