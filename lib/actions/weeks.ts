'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { canAdmin, canWrite, inCampus, requireOrg, type OrgContext } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { parseAmount } from '@/lib/money';
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

export async function openWeek(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writeContext(formData);
  if (!ctx) return DENIED;

  // El periodo es el que elija quien lo abre: una semana, una quincena, un
  // mes. Lo unico que la base exige es que no se pise con otro del campus.
  const start = String(formData.get('start_date') ?? '');
  const end = String(formData.get('end_date') ?? '');
  const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

  if (!isDate(start) || !isDate(end)) return { error: 'Elegí desde qué día hasta qué día va.' };
  // Fechas ISO: comparar los strings alcanza y evita construir dos Date.
  if (end < start) return { error: 'El "hasta" no puede ser anterior al "desde".' };

  // Todo periodo es de un campus: no existe mas el libro de toda la
  // organizacion, porque cada campus puede llevar su propia moneda.
  const campusId = String(formData.get('campus_id') ?? '');
  if (!campusId) return { error: 'Elegí el campus.' };
  if (!inCampus(ctx, campusId)) return { error: 'Ese campus no es el tuyo.' };

  const supabase = await createClient();
  const { data: week, error } = await supabase
    .from('weeks')
    .insert({
      organization_id: ctx.organization.id,
      campus_id: campusId,
      start_date: start,
      end_date: end,
    })
    .select('id')
    .single();

  if (error) return fail(error);
  if (!week) return { error: 'No se pudo abrir el período.' };

  revalidatePath(`/${ctx.organization.slug}/semanal`);
  redirect(weekPath(ctx, week.id));
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

export async function closeWeek(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writeContext(formData);
  if (!ctx) return DENIED;

  const weekId = String(formData.get('week_id'));
  const supabase = await createClient();
  if (!(await ownWeek(supabase, ctx, weekId))) return NOT_MINE;

  const { error } = await supabase
    .from('weeks')
    .update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: ctx.userId })
    .eq('id', weekId)
    .eq('organization_id', ctx.organization.id);

  if (error) return fail(error);

  revalidatePath(`/${ctx.organization.slug}/semanal`, 'layout');
  return { message: 'Período cerrado.' };
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

export async function addWeekEntry(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writeContext(formData);
  if (!ctx) return DENIED;

  const weekId = String(formData.get('week_id'));
  const supabase = await createClient();
  const check = await openWeekRow(supabase, ctx, weekId);
  if ('error' in check) return { error: check.error };

  const amount = parseAmount(formData.get('amount'));
  if (!Number.isFinite(amount) || amount < 0) return { error: 'Poné un monto válido.' };

  const { data: concept } = await supabase
    .from('week_concepts')
    .select('id, name, has_movement_count, allowed_currencies')
    .eq('id', String(formData.get('concept_id')))
    .eq('organization_id', ctx.organization.id)
    .maybeSingle();

  if (!concept) return { error: 'Ese concepto no existe.' };

  const rawMovements = String(formData.get('movement_count') ?? '').trim();
  const movements = concept.has_movement_count && rawMovements ? Number(rawMovements) : null;
  if (movements !== null && (!Number.isFinite(movements) || movements < 0)) {
    return { error: 'La cantidad de movimientos tiene que ser un número.' };
  }

  // La moneda habilitada y la fecha dentro del periodo las valida un trigger:
  // aca solo traducimos su mensaje si salta.
  const { error } = await supabase.from('week_entries').insert({
    week_id: weekId,
    concept_id: concept.id,
    currency_code: String(formData.get('currency_code') || 'ARS'),
    amount,
    movement_count: movements,
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
