'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { canAdmin, canWrite, inCampus, requireOrg, type OrgContext } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { parseAmount } from '@/lib/money';
import { attachReportPdf } from '@/lib/pdf/profit-loss';
import { EXPENSE_FIELDS, FOUNDATION_FIELDS, REVENUE_FIELDS } from '@/lib/reports';
import type { FormState } from '@/lib/forms';

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function writeContext(formData: FormData) {
  const ctx = await requireOrg(String(formData.get('slug') ?? ''));
  if (!canWrite(ctx.role)) return null;
  return ctx;
}

const DENIED: FormState = { error: 'No tenés permiso para cargar el reporte.' };
const NOT_MINE: FormState = { error: 'Ese reporte no existe.' };

/** Un monto del formulario, o cero si no se cargo nada. */
function money(value: FormDataEntryValue | null): number {
  const parsed = parseAmount(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Lo mismo pero conservando el signo, para el Foundation Budget: ahi un
 * negativo es un dato y no un error, porque es lo que resta del saldo final.
 */
function signedMoney(value: FormDataEntryValue | null): number {
  const parsed = parseAmount(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Asistencia, participacion, salvaciones. Llegan agrupadas: "2.000". */
function count(value: FormDataEntryValue | null): number {
  const parsed = Math.trunc(parseAmount(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function reportPath(ctx: OrgContext, id: string) {
  return `/${ctx.organization.slug}/reportes/${id}`;
}

/** El reporte tiene que ser de esta organizacion y del campus del miembro. */
async function ownReport(supabase: Supabase, ctx: OrgContext, id: string) {
  const { data } = await supabase
    .from('pl_reports')
    .select('id, status, campus_id')
    .eq('id', id)
    .eq('organization_id', ctx.organization.id)
    .maybeSingle();

  if (!data || !inCampus(ctx, data.campus_id)) return null;
  return data;
}

/**
 * Abre el reporte de un periodo que se quedo sin el.
 *
 * Normalmente no hace falta: el reporte nace junto con el periodo, cuando un
 * administrador lo abre en Semanal. Esto es para los periodos que vienen de
 * antes de que los dos modulos estuvieran atados, que no tienen ninguno.
 *
 * Nace vacio y en borrador. Se llena solo al cerrar el periodo; hasta
 * entonces se puede cargar a mano lo que no salga del Semanal.
 */
export async function openReport(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writeContext(formData);
  if (!ctx) return DENIED;

  const weekId = String(formData.get('week_id') ?? '');
  if (!weekId) return { error: 'Falta el período.' };

  const supabase = await createClient();
  const { data: week } = await supabase
    .from('weeks')
    .select('id, campus_id, start_date, end_date, campuses!inner(default_currency)')
    .eq('id', weekId)
    .eq('organization_id', ctx.organization.id)
    .maybeSingle();

  if (!week) return { error: 'Ese período no existe.' };
  if (!inCampus(ctx, week.campus_id)) return { error: 'Ese período no es de tu campus.' };

  const campus = week.campuses as unknown as { default_currency: string };

  const { data: report, error } = await supabase
    .from('pl_reports')
    .insert({
      organization_id: ctx.organization.id,
      campus_id: week.campus_id,
      week_id: week.id,
      start_date: week.start_date,
      end_date: week.end_date,
      currency_code: campus.default_currency,
      created_by: ctx.userId,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') return { error: 'Ese período ya tiene reporte.' };
    return { error: error.message };
  }

  revalidatePath(`/${ctx.organization.slug}/reportes`);
  revalidatePath(`/${ctx.organization.slug}/semanal/${weekId}`);
  redirect(reportPath(ctx, report.id));
}

/**
 * Guarda los renglones. Todo junto y no campo por campo: el reporte se
 * completa de una sentada mirando una planilla, y guardar a medias dejaria
 * totales que no cierran con nada.
 */
export async function saveReport(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writeContext(formData);
  if (!ctx) return DENIED;

  const id = String(formData.get('id'));
  const supabase = await createClient();
  const report = await ownReport(supabase, ctx, id);

  if (!report) return NOT_MINE;
  if (report.status === 'closed') {
    return { error: 'El reporte está cerrado. Reabrilo para poder editarlo.' };
  }

  const attendance = count(formData.get('attendance'));
  const participants = count(formData.get('participants'));
  if (participants > attendance) {
    return { error: 'Los que participaron no pueden ser más que los que asistieron.' };
  }

  const amounts = Object.fromEntries(
    [...REVENUE_FIELDS, ...EXPENSE_FIELDS].map((field) => [field.key, money(formData.get(field.key))]),
  );

  const foundation = Object.fromEntries(
    FOUNDATION_FIELDS.map((field) => [field.key, signedMoney(formData.get(field.key))]),
  );

  const { error } = await supabase
    .from('pl_reports')
    .update({
      ...amounts,
      ...foundation,
      attendance,
      participants,
      salvations: count(formData.get('salvations')),
      notes: String(formData.get('notes') ?? '').trim() || null,
    })
    .eq('id', id);

  if (error) return { error: error.message };

  revalidatePath(reportPath(ctx, id));
  return { message: 'Reporte guardado.' };
}

/** Cerrarlo lo congela: es lo que se manda a HF. */
export async function closeReport(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writeContext(formData);
  if (!ctx) return DENIED;

  const id = String(formData.get('id'));
  const supabase = await createClient();
  const report = await ownReport(supabase, ctx, id);

  if (!report) return NOT_MINE;
  if (report.status === 'closed') return { error: 'Ese reporte ya está cerrado.' };

  // Se guarda antes de cerrar: si no, lo tipeado y todavia sin guardar se
  // perderia justo en el paso que lo vuelve inmutable.
  const saved = await saveReport(_prev, formData);
  if (saved.error) return saved;

  const { error } = await supabase
    .from('pl_reports')
    .update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: ctx.userId })
    .eq('id', id);

  if (error) return { error: error.message };

  // Recien ahora se congela el PDF: es el papel que se manda a HF, y mientras
  // el reporte era borrador no habia nada definitivo que imprimir.
  const pdf = await attachReportPdf(supabase, id);

  revalidatePath(`/${ctx.organization.slug}/reportes`);
  revalidatePath(reportPath(ctx, id));

  return {
    message: pdf
      ? 'Reporte cerrado. El PDF quedó listo para descargar.'
      : 'Reporte cerrado, pero no pudimos generar el PDF. Volvé a entrar más tarde.',
  };
}

export async function reopenReport(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writeContext(formData);
  if (!ctx) return DENIED;
  // Reabrir deshace un reporte ya mandado: queda para administradores.
  if (!canAdmin(ctx.role)) {
    return { error: 'Solo un administrador puede reabrir un reporte cerrado.' };
  }

  const id = String(formData.get('id'));
  const supabase = await createClient();
  if (!(await ownReport(supabase, ctx, id))) return NOT_MINE;

  // El PDF se va con el cierre: el que quedaba era de los números de antes,
  // y dejarlo descargable sería repartir un papel que ya no dice la verdad.
  const { error } = await supabase
    .from('pl_reports')
    .update({ status: 'draft', closed_at: null, closed_by: null, pdf_path: null })
    .eq('id', id);

  if (error) return { error: error.message };

  revalidatePath(`/${ctx.organization.slug}/reportes`);
  return { message: 'Reporte reabierto.' };
}

// ============================================================
// Cotizaciones
// ============================================================

/**
 * Carga o corrige la cotizacion de una moneda para un periodo.
 *
 * Es de administradores porque decide dos cosas a la vez: cuanto vale en
 * moneda local lo que se cargo en otra dentro del Semanal, y cuanto pesa
 * cada campus en el consolidado en dolares. Cambiarla mueve los dos.
 */
export async function saveExchangeRate(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireOrg(String(formData.get('slug') ?? ''));
  if (!canAdmin(ctx.role)) {
    return { error: 'Solo un administrador carga las cotizaciones.' };
  }

  const currency = String(formData.get('currency_code') ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { error: 'Elegí la moneda.' };
  if (currency === 'USD') return { error: 'El dólar no se cotiza contra sí mismo.' };

  const date = String(formData.get('period_start') ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Elegí el período.' };

  // parseAmount y no un replace a mano: el campo llega con separadores de
  // miles, y sacar solo la coma leia "4.100" como 4,1.
  const rate = parseAmount(formData.get('units_per_usd'));
  if (!Number.isFinite(rate) || rate <= 0) {
    return { error: `Poné cuántos ${currency} equivalen a un dólar.` };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('exchange_rates')
    .upsert(
      {
        organization_id: ctx.organization.id,
        currency_code: currency,
        period_start: date,
        units_per_usd: rate,
        created_by: ctx.userId,
      },
      { onConflict: 'organization_id,currency_code,period_start' },
    );

  if (error) return { error: error.message };

  // La cotizacion se usa en las dos puntas: convierte dentro del Semanal y
  // consolida en el reporte. Las dos pantallas tienen que verla al toque.
  revalidatePath(`/${ctx.organization.slug}/semanal`, 'layout');
  revalidatePath(`/${ctx.organization.slug}/reportes/consolidado`);
  return { message: `Cotización de ${currency} guardada.` };
}
