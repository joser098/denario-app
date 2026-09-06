import type { ReactNode } from 'react';
import {
  addPublicSale,
  closeCashbox,
  removePublicSale,
  startCashbox,
} from '@/lib/actions/public-sales';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatLong, formatTime } from '@/lib/dates';
import { formatMoney, formatTotals } from '@/lib/money';
import { methodLabel, methodsOf, type Breakdown } from '@/lib/sundays';
import { pdfName } from '@/lib/pdf/names';
import { ActionForm, SubmitButton } from '@/components/form';
import { Alert, Card, Field, Input, Select, Textarea } from '@/components/ui';

export const metadata = { title: 'Caja de ventas' };

/**
 * Superficie publica de ventas: la usa quien vende, desde el telefono y sin
 * cuenta. Tener el link es la autorizacion, asi que todo se busca por
 * sales_public_id.
 */
export default async function PublicSalesPage(props: PageProps<'/v/[publicId]'>) {
  const { publicId } = await props.params;

  const supabase = createAdminClient();
  const { data: meeting } = await supabase
    .from('sunday_meetings')
    .select(
      'id, label, start_time, status, sundays!inner(service_date, status, organization_id, campuses!inner(name, organizations!inner(name)))',
    )
    .eq('sales_public_id', publicId)
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
    organization_id: string;
    campuses: { name: string; organizations: { name: string } };
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

  const { data: session } = await supabase
    .from('meeting_sales_sessions')
    .select('*')
    .eq('meeting_id', meeting.id)
    .maybeSingle();

  // ---------- Caja sin abrir ----------
  if (!session) {
    return (
      <Shell>
        {header}
        <Card className="p-6">
          <h1 className="mb-1 text-sm font-medium text-zinc-900">Abrir la caja</h1>
          <p className="mb-4 text-xs text-zinc-500">
            Poné tu nombre y empezá a registrar las ventas. Al final cerrás la caja y queda el
            comprobante firmado.
          </p>
          <ActionForm action={startCashbox} submitLabel="Abrir caja">
            <input type="hidden" name="public_id" value={publicId} />
            <Field label="Tu nombre">
              <Input name="seller_name" required autoFocus />
            </Field>
          </ActionForm>
        </Card>
      </Shell>
    );
  }

  const { data: sales } = await supabase
    .from('sales')
    .select('*')
    .eq('session_id', session.id)
    .order('created_at', { ascending: false });

  const saleIds = (sales ?? []).map((s) => s.id);
  const { data: lines } = saleIds.length
    ? await supabase.from('sale_lines').select('*').in('sale_id', saleIds)
    : { data: [] };

  const totals: Breakdown = { total: {}, byMethod: {} };
  for (const sale of sales ?? []) {
    for (const line of (lines ?? []).filter((l) => l.sale_id === sale.id)) {
      const amount = Number(line.subtotal);
      totals.total[sale.currency_code] = (totals.total[sale.currency_code] ?? 0) + amount;
      const bucket = totals.byMethod[sale.payment_method] ?? {};
      bucket[sale.currency_code] = (bucket[sale.currency_code] ?? 0) + amount;
      totals.byMethod[sale.payment_method] = bucket;
    }
  }
  const methods = methodsOf(totals);

  const summary = (
    <Card className="flex flex-col gap-1 p-5">
      <p className="text-xs font-medium text-zinc-500">Vendido por {session.seller_name}</p>
      <p className="text-2xl font-semibold tabular-nums text-zinc-900">
        {formatTotals(totals.total)}
      </p>
      {methods.map((method) => (
        <p key={method} className="text-sm text-zinc-500">
          {methodLabel(method)} {formatTotals(totals.byMethod[method])}
        </p>
      ))}
    </Card>
  );

  // ---------- Caja cerrada ----------
  if (session.status === 'closed') {
    const receipt = session.pdf_path
      ? (
          await supabase.storage
            .from('actas')
            .createSignedUrl(session.pdf_path, 300, {
              download: pdfName({
                kind: 'caja',
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
        <Alert tone="success">La caja está cerrada. Gracias.</Alert>
        {summary}
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

  const { data: products } = await supabase
    .from('products')
    .select('*')
    .eq('organization_id', sunday.organization_id)
    .eq('is_active', true)
    .order('sort_order');

  // ---------- Caja abierta ----------
  return (
    <Shell>
      {header}
      {summary}

      <Card className="p-5">
        <h2 className="mb-4 text-sm font-medium text-zinc-900">Registrar una venta</h2>
        {(products ?? []).length === 0 ? (
          <Alert tone="info">No hay productos cargados. Avisale a la tesorería.</Alert>
        ) : (
          <ActionForm action={addPublicSale} submitLabel="Registrar venta" resetOnSuccess>
            <input type="hidden" name="public_id" value={publicId} />
            <Field label="Producto">
              <Select name="product_id">
                {(products ?? []).map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} — {formatMoney(Number(product.price), product.currency_code)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Cantidad">
              <Input name="quantity" type="number" min={1} defaultValue={1} />
            </Field>
            <Field label="Cómo te pagaron">
              <Select name="payment_method" defaultValue="cash">
                <option value="cash">Efectivo</option>
                <option value="mercadopago">MercadoPago</option>
              </Select>
            </Field>
          </ActionForm>
        )}
      </Card>

      {(sales ?? []).length > 0 ? (
        <Card className="divide-y divide-zinc-100">
          {(sales ?? []).map((sale) => {
            const line = (lines ?? []).find((l) => l.sale_id === sale.id);
            return (
              <div key={sale.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-zinc-900">
                    {line ? `${line.quantity} × ${line.product_name}` : 'Venta'}
                  </p>
                  <p className="text-xs text-zinc-500">{methodLabel(sale.payment_method)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-sm tabular-nums text-zinc-900">
                    {formatMoney(Number(line?.subtotal ?? 0), sale.currency_code)}
                  </span>
                  <form action={removePublicSale}>
                    <input type="hidden" name="public_id" value={publicId} />
                    <input type="hidden" name="id" value={sale.id} />
                    <SubmitButton variant="ghost">Borrar</SubmitButton>
                  </form>
                </div>
              </div>
            );
          })}
        </Card>
      ) : null}

      <Card className="p-5">
        <h2 className="mb-1 text-sm font-medium text-zinc-900">Cerrar la caja</h2>
        <p className="mb-4 text-xs text-zinc-500">
          Al cerrar no se pueden cargar ni borrar más ventas. Hacelo cuando termines.
        </p>
        <ActionForm action={closeCashbox} submitLabel="Cerrar la caja">
          <input type="hidden" name="public_id" value={publicId} />
          <Field label="Testigo" hint="Quién acompaña el cierre. Opcional.">
            <Input name="witness_name" />
          </Field>
          <Field label="Observaciones">
            <Textarea name="notes" placeholder="Algo para avisar (opcional)." />
          </Field>
        </ActionForm>
      </Card>
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
