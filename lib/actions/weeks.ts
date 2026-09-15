'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { canAdmin, canWrite, inCampus, requireOrg, type OrgContext } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { parseAmount } from '@/lib/money';
import { attachWeekPdf } from '@/lib/pdf/semanal';
import { EXPENSE_BY_KEY, isBlankReport } from '@/lib/reports';
import { loadWeek } from '@/lib/week-data';
import type { WeekSummary } from '@/lib/weeks';
import type { ExpenseKey } from '@/lib/database.types';
import type { FormState } from '@/lib/forms';

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function writeContext(formData: FormData) {
  const ctx = await requireOrg(String(formData.get('slug') ?? ''));
  if (!canWrite(ctx.role)) return null;
  return ctx;
}

const DENIED: FormState = { error: 'No tenés permiso para cargar movimientos.' };

/** Un periodo de otro campus no existe para quien esta acotado al suyo. */
const NOT_MINE: FormState = { error: 'Ese período no existe.' };

function fail(error: { message: string; code?: string }): FormState {
  if (error.code === '23505') return { error: 'Ese período ya está abierto.' };
  // 23P01: la exclusion constraint. Dos períodos del mismo campus no se pisan.
  if (error.code === '23P01') {
    return { error: 'Ese período se pisa con otro que ya está abierto.' };
  }
  return { error: error.message };
}

function weekPath(ctx: OrgContext, weekId: string) {
  return `/${ctx.organization.slug}/semanal/${weekId}`;
}

/**
 * El periodo tiene que existir, ser de esta organizacion y del campus del
 * miembro, y estar abierto.
 */
async function ownWeek(supabase: Supabase, ctx: OrgContext, weekId: string) {
  const { data } = await supabase
    .from('weeks')
    .select('id, status, campus_id')
    .eq('id', weekId)
    .eq('organization_id', ctx.organization.id)
    .maybeSingle();

  if (!data || !inCampus(ctx, data.campus_id)) return null;
  return data;
}

async function openWeekRow(supabase: Supabase, ctx: OrgContext, weekId: string) {
  const week = await ownWeek(supabase, ctx, weekId);

  if (!week) return { error: NOT_MINE.error } as const;
  if (week.status === 'closed') {
    return { error: 'El período está cerrado. Reabrilo para poder cargar.' } as const;
  }
  return { week } as const;
}

// ============================================================
// El periodo
// ============================================================

/**
 * Abre el periodo en toda la organizacion.
 *
 * Un periodo por campus y, colgado de cada uno, su Profit & Loss: los tres
 * modulos pasan a hablar del mismo tramo de calendario. Por eso lo abre un
 * administrador y no cada tesorero — si cada campus eligiera sus fechas, el
 * consolidado sumaria semanas que no son la misma semana.
 *
 * La base lo hace de una sola vez (`open_period`): si un campus no puede
 * abrirlo, no abre ninguno. Medio periodo abierto es peor que ninguno,
 * porque el gasto del campus que quedo afuera no tiene donde caer y nadie se
 * entera hasta que alguien lo busca.
 */
export async function openPeriod(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireOrg(String(formData.get('slug') ?? ''));
  if (!canAdmin(ctx.role)) {
    return { error: 'Solo un administrador abre el período.' };
  }

  // El periodo es el que elija quien lo abre: una semana, una quincena, un
  // mes. Lo unico que la base exige es que no se pise con otro del campus.
  const start = String(formData.get('start_date') ?? '');
  const end = String(formData.get('end_date') ?? '');
  const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

  if (!isDate(start) || !isDate(end)) return { error: 'Elegí desde qué día hasta qué día va.' };
  // Fechas ISO: comparar los strings alcanza y evita construir dos Date.
  if (end < start) return { error: 'El "hasta" no puede ser anterior al "desde".' };

  const supabase = await createClient();
  const { data: opened, error } = await supabase.rpc('open_period', {
    p_org: ctx.organization.id,
    p_start: start,
    p_end: end,
  });

  if (error) return fail(error);

  revalidatePath(`/${ctx.organization.slug}/semanal`, 'layout');
  revalidatePath(`/${ctx.organization.slug}/reportes`, 'layout');
  return {
    message: `Período abierto en ${opened} campus, con su Profit & Loss.`,
  };
}

/**
 * Borra un periodo abierto por error, en toda la organizacion.
 *
 * Se abre en todos los campus de una vez, asi que se borra igual: un periodo
 * que existe en tres campus y no en el cuarto es peor que ninguno — el que
 * quedo afuera no tiene donde registrar un gasto y nadie se entera hasta que
 * lo busca.
 *
 * Solo mientras no lo haya tocado nadie: sin movimientos, sin ningun campus
 * cerrado y con los Profit & Loss todavia en blanco. En cuanto entra el
 * primer numero deja de ser un error de tipeo y pasa a ser un libro.
 */
export async function deletePeriod(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireOrg(String(formData.get('slug') ?? ''));
  if (!canAdmin(ctx.role)) return { error: 'Solo un administrador borra un período.' };

  // Un administrador acotado a un campus solo alcanza las semanas de ese
  // campus: borraria la suya y dejaria las otras. Mejor no empezar.
  if (ctx.campusId) {
    return {
      error: 'El período es de toda la organización. Un administrador acotado a un campus no puede borrarlo.',
    };
  }

  const start = String(formData.get('start_date') ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return { error: 'Falta el período.' };

  const supabase = await createClient();
  const { data: weeks } = await supabase
    .from('weeks')
    .select('id, status')
    .eq('organization_id', ctx.organization.id)
    .eq('start_date', start);

  if (!weeks || weeks.length === 0) return { error: 'Ese período no existe.' };
  if (weeks.some((week) => week.status === 'closed')) {
    return { error: 'Ya hay campus con el período cerrado. Un cierre no se borra.' };
  }

  const ids = weeks.map((week) => week.id);

  const { count } = await supabase
    .from('week_entries')
    .select('id', { count: 'exact', head: true })
    .in('week_id', ids);

  if (count) {
    return {
      error: `No se puede borrar: el período ya tiene ${count} movimiento(s) cargado(s). Si bajaron de un domingo, reabrilo para retirarlos.`,
    };
  }

  const { data: reports } = await supabase.from('pl_reports').select('*').in('week_id', ids);
  const written = (reports ?? []).filter(
    (report) => report.status === 'closed' || !isBlankReport(report),
  );

  if (written.length > 0) {
    return {
      error: `No se puede borrar: ${written.length} Profit & Loss de este período ya tiene(n) números cargados.`,
    };
  }

  // El reporte se borra a mano y no por cascada: la clave foránea lo deja
  // huérfano en vez de arrastrarlo, a propósito, para que un reporte viejo
  // sobreviva a cualquier limpieza de periodos. Acá sabemos que están en
  // blanco, así que se van con su periodo.
  const { error: reportError } = await supabase.from('pl_reports').delete().in('week_id', ids);
  if (reportError) return fail(reportError);

  const { error } = await supabase.from('weeks').delete().in('id', ids);
  if (error) return fail(error);

  revalidatePath(`/${ctx.organization.slug}/semanal`, 'layout');
  revalidatePath(`/${ctx.organization.slug}/reportes`, 'layout');
  redirect(`/${ctx.organization.slug}/semanal`);
}

export async function updateWeekNotes(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await writeContext(formData);
  if (!ctx) return DENIED;

  const weekId = String(formData.get('week_id'));
  const supabase = await createClient();
  const check = await openWeekRow(supabase, ctx, weekId);
  if ('error' in check) return { error: check.error };

  const { error } = await supabase
    .from('weeks')
    .update({ notes: String(formData.get('notes') ?? '').trim() || null })
    .eq('id', weekId)
    .eq('organization_id', ctx.organization.id);

  if (error) return fail(error);

  revalidatePath(weekPath(ctx, weekId));
  return { message: 'Notas guardadas.' };
}

/**
 * Cierra el periodo y lo manda al Profit & Loss.
 *
 * Antes de cerrar hay dos cosas que tienen que estar, porque el reporte se
 * arma con ellas y despues no hay forma de arreglarlo sin reabrir:
 *
 *   - la cotizacion de toda moneda que se haya cargado, porque sin ella no
 *     hay un total en la moneda del campus, solo montos sueltos;
 *   - la categoria de cada egreso, porque un gasto sin categoria no sabe a
 *     que renglon del reporte bajar y quedaria afuera en silencio.
 */
export async function closeWeek(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writeContext(formData);
  if (!ctx) return DENIED;

  const weekId = String(formData.get('week_id'));
  const supabase = await createClient();
  if (!(await ownWeek(supabase, ctx, weekId))) return NOT_MINE;

  const loaded = await loadWeek(supabase, ctx.organization.id, weekId);
  if (!loaded) return NOT_MINE;

  const { summary, currency } = loaded;

  if (summary.missingRates.length > 0) {
    return {
      error: `Falta cargar cuántos ${summary.missingRates.join(' y ')} equivalen a un dólar en este período. La carga un administrador acá mismo, y sin eso no hay total en ${currency}.`,
    };
  }

  if (summary.uncategorized > 0) {
    return {
      error: `Hay ${summary.uncategorized} egreso(s) sin categoría. Elegiles una para que sepan a qué renglón del Profit & Loss bajar.`,
    };
  }

  const { error } = await supabase
    .from('weeks')
    .update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: ctx.userId })
    .eq('id', weekId)
    .eq('organization_id', ctx.organization.id);

  if (error) return fail(error);

  const fed = await feedReport(supabase, weekId, summary);
  const pdf = await attachWeekPdf(supabase, weekId);

  revalidatePath(`/${ctx.organization.slug}/semanal`, 'layout');
  revalidatePath(`/${ctx.organization.slug}/reportes`, 'layout');

  if (!pdf) {
    return {
      message: 'Período cerrado, pero no pudimos generar el PDF. Volvé a entrar más tarde.',
    };
  }

  const FED: Record<typeof fed, string> = {
    fed: 'Período cerrado. Los números bajaron al Profit & Loss y el PDF quedó listo.',
    closed: 'Período cerrado y PDF listo. El Profit & Loss ya estaba cerrado, así que no se tocó.',
    none: 'Período cerrado y PDF listo. Este período no tiene Profit & Loss: abrilo para que reciba los números.',
  };

  return { message: FED[fed] };
}

/**
 * Deja los numeros del periodo en el Profit & Loss que cuelga de el.
 *
 * Se escriben en la fila y no se calculan al leer porque el reporte es
 * editable: quien lo manda a HF puede ajustar un renglon, y ese ajuste tiene
 * que sobrevivir. La pantalla del reporte sigue mostrando al lado lo que dice
 * el Semanal, asi que una diferencia se ve.
 *
 * Un reporte ya cerrado no se toca: es un papel que ya se mando.
 */
async function feedReport(
  supabase: Supabase,
  weekId: string,
  summary: WeekSummary,
): Promise<'fed' | 'closed' | 'none'> {
  const { data: report } = await supabase
    .from('pl_reports')
    .select('id, status, attendance')
    .eq('week_id', weekId)
    .maybeSingle();

  if (!report) return 'none';
  if (report.status === 'closed') return 'closed';

  const { error } = await supabase
    .from('pl_reports')
    .update({
      ...summary.revenue,
      ...summary.expenses,
      participants: summary.participants,
      // Los que participaron no pueden ser mas que los que vinieron, y la
      // asistencia se carga a mano en el reporte. Si todavia no la cargaron,
      // la participacion que baja del Semanal la arrastra: es el piso de lo
      // que se sabe, y quien complete el reporte la va a corregir.
      attendance: Math.max(report.attendance, summary.participants),
    })
    .eq('id', report.id);

  return error ? 'none' : 'fed';
}

export async function reopenWeek(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writeContext(formData);
  if (!ctx) return DENIED;
  // Reabrir deshace un cierre: queda para administradores.
  if (!canAdmin(ctx.role)) {
    return { error: 'Solo un administrador puede reabrir un período cerrado.' };
  }

  const weekId = String(formData.get('week_id'));
  const supabase = await createClient();
  if (!(await ownWeek(supabase, ctx, weekId))) return NOT_MINE;

  const { error } = await supabase
    .from('weeks')
    .update({ status: 'open', closed_at: null, closed_by: null })
    .eq('id', weekId)
    .eq('organization_id', ctx.organization.id);

  if (error) return fail(error);

  revalidatePath(`/${ctx.organization.slug}/semanal`, 'layout');
  return { message: 'Período reabierto.' };
}

// ============================================================
// Movimientos del periodo
// ============================================================

/** La categoria que llega del formulario, si es una de las del reporte. */
function expenseKey(value: FormDataEntryValue | null): ExpenseKey | null {
  const key = String(value ?? '');
  return EXPENSE_BY_KEY.has(key as ExpenseKey) ? (key as ExpenseKey) : null;
}

/**
 * Le pone categoria a un egreso que ya esta en el libro.
 *
 * Hace falta porque los gastos bajan solos desde Compras, Presupuestos y
 * Pagos, y ahi nadie eligio en que renglon del reporte caen. Se categorizan
 * aca, mirando la semana entera, que es cuando se entiende que fue cada uno.
 */
export async function setEntryCategory(formData: FormData) {
  const ctx = await writeContext(formData);
  if (!ctx) return;

  const weekId = String(formData.get('week_id'));
  const supabase = await createClient();
  const check = await openWeekRow(supabase, ctx, weekId);
  if ('error' in check) return;

  const category = expenseKey(formData.get('pl_expense_key'));
  if (!category) return;

  await supabase
    .from('week_entries')
    .update({ pl_expense_key: category })
    .eq('id', String(formData.get('id')))
    .eq('week_id', weekId);

  revalidatePath(weekPath(ctx, weekId));
}

export async function addWeekEntry(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writeContext(formData);
  if (!ctx) return DENIED;

  const weekId = String(formData.get('week_id'));
  const supabase = await createClient();
  const check = await openWeekRow(supabase, ctx, weekId);
  if ('error' in check) return { error: check.error };

  const { data: concept } = await supabase
    .from('week_concepts')
    .select('id, name, kind, counts_only, has_movement_count, allowed_currencies')
    .eq('id', String(formData.get('concept_id')))
    .eq('organization_id', ctx.organization.id)
    .maybeSingle();

  if (!concept) return { error: 'Ese concepto no existe.' };

  // Transacciones y sobres no son plata: lo que se carga es cuantos fueron.
  // Guardarles un monto seria contar dos veces algo que ya esta en otra
  // linea del libro.
  const amount = concept.counts_only ? 0 : parseAmount(formData.get('amount'));
  if (!Number.isFinite(amount) || amount < 0) return { error: 'Poné un monto válido.' };

  const rawMovements = String(formData.get('movement_count') ?? '').trim();
  const movements = concept.has_movement_count && rawMovements ? Number(rawMovements) : null;
  if (movements !== null && (!Number.isFinite(movements) || movements < 0)) {
    return { error: 'La cantidad de movimientos tiene que ser un número.' };
  }
  if (concept.counts_only && !movements) {
    return { error: `Poné cuántos ${concept.name.toLowerCase()} hubo.` };
  }

  const category = expenseKey(formData.get('pl_expense_key'));
  if (concept.kind === 'expense' && !category) {
    return { error: 'Elegí la categoría del gasto: es el renglón del Profit & Loss donde cae.' };
  }

  // La moneda habilitada y la fecha dentro del periodo las valida un trigger:
  // aca solo traducimos su mensaje si salta.
  const { error } = await supabase.from('week_entries').insert({
    week_id: weekId,
    concept_id: concept.id,
    currency_code: String(formData.get('currency_code') || 'ARS'),
    amount,
    movement_count: movements,
    pl_expense_key: concept.kind === 'expense' ? category : null,
    entry_date: (formData.get('entry_date') as string) || null,
    description: String(formData.get('description') ?? '').trim() || null,
    created_by: ctx.userId,
  });

  if (error) return fail(error);

  revalidatePath(weekPath(ctx, weekId));
  return { message: `Cargado en ${concept.name}.` };
}

export async function deleteWeekEntry(formData: FormData) {
  const ctx = await writeContext(formData);
  if (!ctx) return;

  const weekId = String(formData.get('week_id'));
  const supabase = await createClient();
  const check = await openWeekRow(supabase, ctx, weekId);
  if ('error' in check) return;

  // Los movimientos con origen los genero un flujo (una compra entregada, un
  // presupuesto pagado): se deshacen desde ahi, no borrando la fila suelta.
  await supabase
    .from('week_entries')
    .delete()
    .eq('id', String(formData.get('id')))
    .eq('week_id', weekId)
    .is('source_type', null);

  revalidatePath(weekPath(ctx, weekId));
}
