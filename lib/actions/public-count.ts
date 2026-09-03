'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { campusCurrencies, listDenominations } from '@/lib/currencies';
import { parseCountLines } from '@/lib/count-lines';
import { attachCountActa } from '@/lib/pdf/actas';
import type { FormState } from '@/lib/forms';

/**
 * Carga del acta desde el link publico (`/r/<publicId>`).
 *
 * Corre con el cliente service-role porque el voluntario no tiene sesion y
 * ninguna policy puede autorizarlo: la autorizacion es tener el link. Por eso
 * todo lo que sigue busca SIEMPRE por public_id y valida a mano lo que RLS
 * haria si hubiera un usuario.
 */
export async function submitPublicCount(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const publicId = String(formData.get('public_id') ?? '').trim();
  if (!publicId) return { error: 'Link inválido.' };

  const volunteer = String(formData.get('volunteer_name') ?? '').trim();
  const witness = String(formData.get('witness_1_name') ?? '').trim();
  if (!volunteer) return { error: 'Poné tu nombre.' };
  if (!witness) return { error: 'Poné el nombre de al menos un testigo.' };

  const supabase = createAdminClient();

  const { data: meeting } = await supabase
    .from('sunday_meetings')
    .select('id, status, sundays!inner(status, campuses!inner(default_currency))')
    .eq('public_id', publicId)
    .maybeSingle();

  if (!meeting) return { error: 'Este link no corresponde a ninguna reunión.' };

  const sunday = meeting.sundays as unknown as {
    status: string;
    campuses: { default_currency: string };
  };
  if (meeting.status === 'locked' || sunday.status === 'closed') {
    return { error: 'Esta reunión ya está cerrada. Avisale a la tesorería.' };
  }

  // El indice unico ya lo impide, pero un mensaje claro vale mas que un 23505.
  const { data: existing } = await supabase
    .from('offering_counts')
    .select('id')
    .eq('meeting_id', meeting.id)
    .neq('status', 'voided')
    .maybeSingle();

  if (existing) return { error: 'Esta reunión ya tiene un acta cargada.' };

  // Las denominaciones no son solo lo que se pinta: parseCountLines descarta
  // toda linea que no este en esta lista, asi que acotarla al campus es lo
  // que impide que alguien mande un billete de otra moneda por el link.
  const denominations = await listDenominations(
    supabase,
    campusCurrencies(sunday.campuses.default_currency),
  );

  const lines = parseCountLines(formData, denominations);
  if (lines.length === 0) return { error: 'Cargá al menos un billete.' };

  // Si esta reunion ya tuvo un acta anulada, la nueva queda encadenada a ella.
  const { data: superseded } = await supabase
    .from('offering_counts')
    .select('id')
    .eq('meeting_id', meeting.id)
    .eq('status', 'voided')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // El acta nace como borrador porque las lineas solo se pueden insertar en
  // ese estado; recien despues se firma. Si algo falla en el medio, se borra
  // el borrador para no dejar un acta a medias.
  const { data: count, error: countError } = await supabase
    .from('offering_counts')
    .insert({
      meeting_id: meeting.id,
      volunteer_name: volunteer,
      witness_1_name: witness,
      witness_2_name: String(formData.get('witness_2_name') ?? '').trim() || null,
      envelopes_count: Math.max(0, Math.trunc(Number(formData.get('envelopes_count') ?? 0)) || 0),
      notes: String(formData.get('notes') ?? '').trim() || null,
      supersedes_id: superseded?.id ?? null,
    })
    .select('id')
    .single();

  if (countError || !count) {
    return { error: 'No se pudo registrar el conteo. Probá de nuevo.' };
  }

  const { error: linesError } = await supabase
    .from('offering_count_lines')
    .insert(lines.map((line) => ({ ...line, offering_count_id: count.id })));

  if (linesError) {
    await supabase.from('offering_counts').delete().eq('id', count.id);
    return { error: 'No se pudo registrar el conteo. Probá de nuevo.' };
  }

  const { error: finalizeError } = await supabase
    .from('offering_counts')
    .update({ status: 'finalized', finalized_at: new Date().toISOString() })
    .eq('id', count.id);

  if (finalizeError) {
    // Las lineas quedaron bien: el acta existe como borrador y la tesoreria
    // puede cerrarla desde la app. Mejor eso que perder el conteo.
    return {
      error: 'Guardamos el conteo pero no pudimos firmarlo. Avisale a la tesorería.',
    };
  }

  await attachCountActa(supabase, count.id);

  revalidatePath(`/r/${publicId}`);
  return { message: 'Listo. El conteo quedó registrado y firmado.' };
}
