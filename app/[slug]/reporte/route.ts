import { NextResponse, type NextRequest } from 'next/server';
import { requireOrg } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { pdfName } from '@/lib/pdf/names';

/**
 * Descarga de un papel del bucket `reportes`: el Profit & Loss de un campus
 * (`?id=`) o el cierre de un periodo del Semanal (`?semanal=`).
 *
 * Los dos sirven el archivo que se congelo al cerrar, no uno armado en el
 * momento: mientras son borrador no hay PDF, y eso es a proposito. La
 * autorizacion la dan RLS sobre la tabla y sobre el bucket.
 */
export async function GET(request: NextRequest, ctx: RouteContext<'/[slug]/reporte'>) {
  const { slug } = await ctx.params;
  const { organization } = await requireOrg(slug);

  const supabase = await createClient();
  const id = request.nextUrl.searchParams.get('id') ?? '';
  const weekId = request.nextUrl.searchParams.get('semanal') ?? '';

  const found = weekId
    ? await weekPdf(supabase, organization.id, weekId)
    : id
      ? await reportPdf(supabase, organization.id, id)
      : null;

  if (!found) return new NextResponse('Todavía no está cerrado', { status: 404 });

  // Con `?ver=1` la URL firmada sale sin `download`, asi que el navegador lo
  // abre en su visor en vez de bajarlo. Es la misma URL y la misma
  // autorizacion: lo unico que cambia es como lo presenta el navegador.
  const view = request.nextUrl.searchParams.get('ver') === '1';

  const { data, error } = await supabase.storage
    .from('reportes')
    .createSignedUrl(found.path, 60, view ? {} : { download: found.name });

  if (error || !data) return new NextResponse('No encontrado', { status: 404 });

  return NextResponse.redirect(data.signedUrl);
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function reportPdf(supabase: Supabase, organizationId: string, id: string) {
  const { data: report } = await supabase
    .from('pl_reports')
    .select('pdf_path, start_date, campuses!inner(name)')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (!report?.pdf_path) return null;

  const campus = report.campuses as unknown as { name: string };
  return {
    path: report.pdf_path,
    name: pdfName({ kind: 'pl', campus: campus.name, date: report.start_date }),
  };
}

async function weekPdf(supabase: Supabase, organizationId: string, id: string) {
  const { data: week } = await supabase
    .from('weeks')
    .select('pdf_path, start_date, campuses!inner(name)')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (!week?.pdf_path) return null;

  const campus = week.campuses as unknown as { name: string };
  return {
    path: week.pdf_path,
    name: pdfName({ kind: 'semanal', campus: campus.name, date: week.start_date }),
  };
}
