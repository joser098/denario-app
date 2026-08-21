'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { canAdmin, canWrite, requireOrg, type OrgContext } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { weekOf } from '@/lib/dates';
import type { FormState } from '@/lib/forms';

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function writeContext(formData: FormData) {
  const ctx = await requireOrg(String(formData.get('slug') ?? ''));
  if (!canWrite(ctx.role)) return null;
  return ctx;
}

const DENIED: FormState = { error: 'No tenés permiso para cargar movimientos.' };

function fail(error: { message: string; code?: string }): FormState {
  if (error.code === '23505') return { error: 'Esa semana ya está abierta.' };
  return { error: error.message };
}

/** "1.234,50" y "1234.50" son la misma plata. */
function money(value: FormDataEntryValue | null): number {
  return Number(String(value ?? '').replace(/\./g, '').replace(',', '.'));
}

function weekPath(ctx: OrgContext, weekId: string) {
  return `/${ctx.organization.slug}/semanal/${weekId}`;
}

/** La semana tiene que existir, ser de esta organizacion y estar abierta. */
async function openWeekRow(supabase: Supabase, ctx: OrgContext, weekId: string) {
  const { data } = await supabase
    .from('weeks')
    .select('id, status')
    .eq('id', weekId)
    .eq('organization_id', ctx.organization.id)
    .maybeSingle();

  if (!data) return { error: 'Esa semana no existe.' } as const;
  if (data.status === 'closed') {
    return { error: 'La semana está cerrada. Reabrila para poder cargar.' } as const;
  }
  return { week: data } as const;
}

// ============================================================
// La semana
// ============================================================

export async function openWeek(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writeContext(formData);
  if (!ctx) return DENIED;

  const date = String(formData.get('any_date') ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Elegí una fecha de la semana.' };

  // La semana del reporte va de martes a lunes: la fecha elegida se corre al
  // martes de esa semana, sea cual sea el dia que hayan puesto.
  const range = weekOf(date);
  const campusId = String(formData.get('campus_id') ?? '');

  const supabase = await createClient();
  const { data: week, error } = await supabase
    .from('weeks')
    .insert({
      organization_id: ctx.organization.id,
      campus_id: campusId || null,
      start_date: range.start,
      end_date: range.end,
    })
    .select('id')
    .single();

  if (error) return fail(error);
  if (!week) return { error: 'No se pudo abrir la semana.' };

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
  const { error } = await supabase
    .from('weeks')
    .update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: ctx.userId })
    .eq('id', weekId)
    .eq('organization_id', ctx.organization.id);

  if (error) return fail(error);

  revalidatePath(`/${ctx.organization.slug}/semanal`, 'layout');
  return { message: 'Semana cerrada.' };
}

export async function reopenWeek(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writeContext(formData);
  if (!ctx) return DENIED;
  // Reabrir deshace un cierre: queda para administradores.
  if (!canAdmin(ctx.role)) {
    return { error: 'Solo un administrador puede reabrir una semana cerrada.' };
  }

  const weekId = String(formData.get('week_id'));
  const supabase = await createClient();
  const { error } = await supabase
    .from('weeks')
    .update({ status: 'open', closed_at: null, closed_by: null })
    .eq('id', weekId)
    .eq('organization_id', ctx.organization.id);

  if (error) return fail(error);

  revalidatePath(`/${ctx.organization.slug}/semanal`, 'layout');
  return { message: 'Semana reabierta.' };
}

// ============================================================
// Movimientos de la semana
// ============================================================

export async function addWeekEntry(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writeContext(formData);
  if (!ctx) return DENIED;

  const weekId = String(formData.get('week_id'));
  const supabase = await createClient();
  const check = await openWeekRow(supabase, ctx, weekId);
  if ('error' in check) return { error: check.error };

  const amount = money(formData.get('amount'));
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

  // La moneda habilitada y la fecha dentro de la semana las valida un trigger:
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
