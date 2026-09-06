import type { ReactNode } from 'react';
import { submitPublicCount } from '@/lib/actions/public-count';
import { createAdminClient } from '@/lib/supabase/admin';
import { campusCurrencies, listDenominations } from '@/lib/currencies';
import { pdfName } from '@/lib/pdf/names';
import { formatLong, formatTime } from '@/lib/dates';
import { ActionForm } from '@/components/form';
import { CountSheet } from '@/components/count-sheet';
import { Alert, Field, Input, Textarea } from '@/components/ui';

export const metadata = { title: 'Conteo de la ofrenda' };

/**
 * Superficie publica: la usa un voluntario desde el telefono, sin cuenta.
 * Tener el link es la autorizacion, asi que todo se busca por public_id.
 */
export default async function PublicCountPage(props: PageProps<'/r/[publicId]'>) {
  const { publicId } = await props.params;

  const supabase = createAdminClient();
  const { data: meeting } = await supabase
    .from('sunday_meetings')
    .select(
      'id, label, start_time, status, sundays!inner(service_date, status, campuses!inner(name, default_currency, organizations!inner(name)))',
    )
    .eq('public_id', publicId)
    .maybeSingle();

  if (!meeting) {
    return (
      <Shell>
        <Alert tone="error">Este link no corresponde a ninguna reunión.</Alert>
      </Shell>
    );
  }

  const sunday = meeting.sundays as unknown as {
    service_date: string;
    status: string;
    campuses: { name: string; default_currency: string; organizations: { name: string } };
  };

  const header = (
    <header className="flex flex-col gap-1 text-center">
      {/* La pantalla tiene que empezar por un encabezado de nivel 1: sin el,
          el lector de pantalla no puede saltar al principio del contenido. */}
      <h1 className="text-lg font-semibold tracking-tight text-zinc-900">
        {sunday.campuses.organizations.name}
      </h1>
      <p className="text-sm text-zinc-500">
        {sunday.campuses.name} · {formatLong(sunday.service_date)}
      </p>
      <p className="text-sm font-medium text-zinc-900">
        {meeting.label} · {formatTime(meeting.start_time)}
      </p>
    </header>
  );

  if (meeting.status === 'locked' || sunday.status === 'closed') {
    return (
      <Shell>
        {header}
        <Alert tone="info">
          Esta reunión ya está cerrada. Si falta cargar algo, avisale a la tesorería.
        </Alert>
      </Shell>
    );
  }

  const { data: existing } = await supabase
    .from('offering_counts')
    .select('status, volunteer_name, pdf_path')
    .eq('meeting_id', meeting.id)
    .neq('status', 'voided')
    .maybeSingle();

  if (existing) {
    // El voluntario no tiene sesion: la URL firmada se arma aca y dura poco.
    const receipt =
      existing.status === 'finalized' && existing.pdf_path
        ? (
            await supabase.storage
              .from('actas')
              .createSignedUrl(existing.pdf_path, 300, {
                download: pdfName({
                  kind: 'acta',
                  campus: sunday.campuses.name,
                  date: sunday.service_date,
                  detail: meeting.label,
                }),
              })
          ).data?.signedUrl
        : null;

    return (
      <Shell>
        {header}
        <Alert tone={existing.status === 'finalized' ? 'success' : 'info'}>
          {existing.status === 'finalized'
            ? `El conteo de esta reunión ya fue registrado${
                existing.volunteer_name ? ` por ${existing.volunteer_name}` : ''
              }.`
            : 'La tesorería ya está cargando el conteo de esta reunión.'}
        </Alert>
        {receipt ? (
          <a
            href={receipt}
            className="text-center text-sm font-medium text-zinc-900 hover:underline"
          >
            Descargar el comprobante (PDF)
          </a>
        ) : null}
      </Shell>
    );
  }

  // Solo la moneda del campus y el dolar: al voluntario no se le puede pedir
  // que cuente reales en Buenos Aires.
  const currencies = campusCurrencies(sunday.campuses.default_currency);
  const denominations = await listDenominations(supabase, currencies);

  return (
    <Shell>
      {header}

      <ActionForm action={submitPublicCount} submitLabel="Firmar y enviar" replaceOnSuccess>
        <input type="hidden" name="public_id" value={publicId} />

        <CountSheet denominations={denominations} currencies={currencies} />

        <Field label="Tu nombre">
          <Input name="volunteer_name" autoComplete="name" required />
        </Field>
        <Field label="Testigo 1">
          <Input name="witness_1_name" required />
        </Field>
        <Field label="Testigo 2">
          <Input name="witness_2_name" />
        </Field>
        <Field
          label="Sobres"
          hint="Cuántos sobres había. No suma al total: la plata de adentro ya la contaste arriba."
        >
          <Input name="envelopes_count" type="number" min={0} defaultValue={0} />
        </Field>
        <Field label="Observaciones">
          <Textarea name="notes" placeholder="Algo raro para avisar (opcional)." />
        </Field>

        <p className="text-xs text-zinc-500">
          Al enviar, el acta queda firmada con estos nombres y no se puede editar. Si te
          equivocaste, la tesorería la anula y hacés una nueva.
        </p>
      </ActionForm>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 justify-center px-4 py-10">
      <div className="flex w-full max-w-md flex-col gap-6">
        {children}
        <p className="text-center text-xs text-zinc-500">Denario</p>
      </div>
    </main>
  );
}
