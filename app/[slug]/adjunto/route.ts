import { NextResponse, type NextRequest } from 'next/server';
import { requireOrg } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

/**
 * Descarga de un comprobante o cotizacion del bucket privado. Mismo criterio
 * que /[slug]/acta: no sirve el archivo, pide una URL firmada de corta vida y
 * redirige. La autorizacion la da RLS sobre storage.objects.
 */
export async function GET(request: NextRequest, ctx: RouteContext<'/[slug]/adjunto'>) {
  const { slug } = await ctx.params;
  const { organization } = await requireOrg(slug);

  const path = request.nextUrl.searchParams.get('path') ?? '';
  if (!path.startsWith(`${organization.id}/`)) {
    return new NextResponse('No encontrado', { status: 404 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.storage.from('adjuntos').createSignedUrl(path, 60);

  if (error || !data) {
    return new NextResponse('No encontrado', { status: 404 });
  }

  return NextResponse.redirect(data.signedUrl);
}
