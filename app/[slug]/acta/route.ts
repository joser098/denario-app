import { NextResponse, type NextRequest } from 'next/server';
import { requireOrg } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { pdfName, type PdfKind } from '@/lib/pdf/names';

/**
 * Descarga de un acta guardada en el bucket privado.
 *
 * No sirve el archivo: pide una URL firmada de corta vida y redirige. La
 * autorizacion la da RLS sobre storage.objects — que mira la organizacion y
 * el campus del domingo que nombra el path — y el chequeo del prefijo evita
 * ademas que alguien pruebe paths de otra organizacion desde esta ruta.
 */
export async function GET(request: NextRequest, ctx: RouteContext<'/[slug]/acta'>) {
  const { slug } = await ctx.params;
  const { organization } = await requireOrg(slug);

  const path = request.nextUrl.searchParams.get('path') ?? '';
  if (!path.startsWith(`${organization.id}/`)) {
    return new NextResponse('No encontrado', { status: 404 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from('actas')
    .createSignedUrl(path, 60, { download: await downloadName(supabase, path) });

  if (error || !data) {
    return new NextResponse('No encontrado', { status: 404 });
  }

  return NextResponse.redirect(data.signedUrl);
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * El tipo sale del nombre con el que se guardo. El `-` es opcional porque los
 * cierres viejos se guardaron como `cierre.pdf`, sin sufijo.
 */
const KIND = /^(acta|cierre|caja)(?:-|\.pdf$)/;

/**
 * `<org>/<sunday_id>/acta-<uuid>.pdf` -> `acta-central-2026-08-30.pdf`.
 *
 * El path guardado se queda como esta: es el identificador del archivo y el
 * segundo segmento es lo que usa RLS para saber de que campus es. Lo que
 * cambia es el nombre con el que llega a la maquina de quien lo baja.
 *
 * Si algo no se puede resolver, cae al nombre del archivo: un PDF con nombre
 * feo es mejor que una descarga que falla.
 */
async function downloadName(supabase: Supabase, path: string): Promise<string> {
  const file = path.split('/').pop() ?? 'acta.pdf';
  const sundayId = path.split('/')[1];
  const kind = file.match(KIND)?.[1] as PdfKind | undefined;

  if (!kind || !sundayId) return file;

  const { data: sunday } = await supabase
    .from('sundays')
    .select('service_date, campuses!inner(name)')
    .eq('id', sundayId)
    .maybeSingle();

  if (!sunday) return file;

  const campus = sunday.campuses as unknown as { name: string };

  // El cierre es uno solo por domingo; el acta de conteo y la caja son una por
  // reunion, asi que llevan la reunion en el nombre para no confundirse entre
  // ellas al bajar varias del mismo domingo.
  const detail = kind === 'cierre' ? undefined : await meetingDetail(supabase, kind, file);

  return pdfName({ kind, campus: campus.name, date: sunday.service_date, detail });
}

async function meetingDetail(
  supabase: Supabase,
  kind: PdfKind,
  file: string,
): Promise<string | undefined> {
  const id = file.replace(/^(acta|caja)-/, '').replace(/\.pdf$/, '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;

  if (kind === 'acta') {
    // Una reunion puede tener mas de un acta: si la primera se anula, la que
    // la reemplaza es del mismo campus, la misma fecha y la misma reunion. El
    // codigo del acta —el que va impreso en el pie del PDF— es lo unico que
    // las distingue, asi que sin el las dos bajarian con el mismo nombre.
    const { data } = await supabase
      .from('offering_counts')
      .select('public_id, sunday_meetings!inner(label)')
      .eq('id', id)
      .maybeSingle();

    if (!data) return undefined;
    const meeting = data.sunday_meetings as unknown as { label: string };
    return `${meeting.label} ${data.public_id}`;
  }

  const { data } = await supabase
    .from('meeting_sales_sessions')
    .select('sunday_meetings!inner(label)')
    .eq('id', id)
    .maybeSingle();
  return (data?.sunday_meetings as unknown as { label: string } | undefined)?.label;
}
