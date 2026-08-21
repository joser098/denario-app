import Link from 'next/link';
import { notFound } from 'next/navigation';
import { canWrite, requireOrg } from '@/lib/auth';
import {
  addIncome,
  addSale,
  deleteIncome,
  deleteSale,
  generateCountActa,
  submitCount,
  voidCount,
} from '@/lib/actions/sundays';
import { createClient } from '@/lib/supabase/server';
import { formatLong, formatTime } from '@/lib/dates';
import { formatMoney, formatTotals, sumByCurrency } from '@/lib/money';
import { siteOrigin } from '@/lib/site';
import {
  COUNT_STATUS_LABELS,
  methodLabel,
  methodsOf,
  type Breakdown,
} from '@/lib/sundays';
import { ActionForm, SubmitButton } from '@/components/form';
import { CopyField } from '@/components/copy-field';
import { CountForm } from '@/components/count-form';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
} from '@/components/ui';

export default async function MeetingPage(
  props: PageProps<'/[slug]/domingos/[sundayId]/reuniones/[meetingId]'>,
) {
  const { slug, sundayId, meetingId } = await props.params;
  const { organization, campuses, role } = await requireOrg(slug);

  const supabase = await createClient();
  const { data: meeting } = await supabase
    .from('sunday_meetings')
    .select('*, sundays!inner(id, organization_id, campus_id, service_date, status)')
    .eq('id', meetingId)
    .eq('sunday_id', sundayId)
    .maybeSingle();

  const sunday = meeting?.sundays as unknown as
    | { organization_id: string; campus_id: string; service_date: string; status: string }
    | undefined;

  if (!meeting || !sunday || sunday.organization_id !== organization.id) notFound();

  const [
    { data: count },
    { data: voided },
    { data: sales },
    { data: incomes },
    { data: products },
    { data: denominations },
    { data: session },
  ] = await Promise.all([
    supabase
      .from('offering_counts')
      .select('*')
      .eq('meeting_id', meetingId)
      .neq('status', 'voided')
      .maybeSingle(),
    supabase
      .from('offering_counts')
      .select('id, volunteer_name, voided_reason, updated_at')
      .eq('meeting_id', meetingId)
      .eq('status', 'voided')
      .order('updated_at', { ascending: false }),
    supabase
      .from('sales')
      .select('*')
      .eq('meeting_id', meetingId)
      .order('created_at'),
    supabase.from('meeting_incomes').select('*').eq('meeting_id', meetingId).order('created_at'),
    supabase
      .from('products')
      .select('*')
      .eq('organization_id', organization.id)
      .eq('is_active', true)
      .order('sort_order'),
    supabase
      .from('currency_denominations')
      .select('currency_code, value')
      .eq('is_active', true),
    supabase
      .from('meeting_sales_sessions')
      .select('*')
      .eq('meeting_id', meetingId)
      .maybeSingle(),
  ]);

  // Las filas hijas van en consultas aparte: los tipos del esquema estan
  // escritos a mano y no describen las relaciones que necesita el embebido.
  const [{ data: lines }, { data: saleLines }] = await Promise.all([
    count
      ? supabase.from('offering_count_lines').select('*').eq('offering_count_id', count.id)
      : Promise.resolve({ data: [] }),
    (sales ?? []).length
      ? supabase
          .from('sale_lines')
          .select('*')
          .in('sale_id', (sales ?? []).map((s) => s.id))
      : Promise.resolve({ data: [] }),
  ]);

  const locked = sunday.status === 'closed' || meeting.status === 'locked';
  const writes = canWrite(role) && !locked;
  const origin = await siteOrigin();
  const campus = campuses.find((c) => c.id === sunday.campus_id);

  const countTotals = sumByCurrency(
    (lines ?? []).map((l) => ({ currency_code: l.currency_code, subtotal: Number(l.subtotal) })),
  );

  // Las ventas van por su cuenta: no forman parte del acta de conteo, ni
  // siquiera las cobradas en efectivo. Lo unico que se abre es el medio de pago.
  const salesTotals: Breakdown = { total: {}, byMethod: {} };
  for (const sale of sales ?? []) {
    const amount = (saleLines ?? [])
      .filter((l) => l.sale_id === sale.id)
      .reduce((sum, l) => sum + Number(l.subtotal), 0);
    if (!amount) continue;

    salesTotals.total[sale.currency_code] =
      (salesTotals.total[sale.currency_code] ?? 0) + amount;

    const bucket = salesTotals.byMethod[sale.payment_method] ?? {};
    bucket[sale.currency_code] = (bucket[sale.currency_code] ?? 0) + amount;
    salesTotals.byMethod[sale.payment_method] = bucket;
  }
  const salesMethods = methodsOf(salesTotals);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href={`/${slug}/domingos/${sundayId}`}
          className="text-sm text-zinc-500 hover:text-zinc-900"
        >
          ← {formatLong(sunday.service_date)}
        </Link>
        <PageHeader
          title={meeting.label}
          subtitle={`${formatTime(meeting.start_time)} · ${campus?.name ?? ''}`}
          actions={locked ? <Badge tone="green">Cerrada</Badge> : undefined}
        />
      </div>

      {locked ? (
        <Alert tone="info">
          El domingo está cerrado: esta reunión quedó en solo lectura. Un administrador puede
          reabrirlo desde la pantalla del domingo.
        </Alert>
      ) : null}

      {/* ---------- Acta de conteo ---------- */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-zinc-900">Acta de conteo</h2>
          {count ? (
            <Badge tone={count.status === 'finalized' ? 'green' : 'amber'}>
              {COUNT_STATUS_LABELS[count.status]}
            </Badge>
          ) : null}
        </div>

        {!count ? (
          <EmptyState
            title="Todavía no se contó esta reunión."
            description="Pasale el link de abajo al voluntario para que lo cargue desde el teléfono."
          />
        ) : count.status === 'draft' && writes ? (
          <Card className="p-6">
            <CountForm
              action={submitCount}
              slug={slug}
              countId={count.id}
              denominations={denominations ?? []}
              quantities={Object.fromEntries(
                (lines ?? []).map((l) => [
                  `${l.currency_code}:${Number(l.denomination_value)}`,
                  l.quantity,
                ]),
              )}
              defaults={{
                volunteer_name: count.volunteer_name ?? '',
                witness_1_name: count.witness_1_name ?? '',
                witness_2_name: count.witness_2_name ?? '',
                envelopes_count: count.envelopes_count,
                notes: count.notes ?? '',
              }}
            />
          </Card>
        ) : (
          <Card className="flex flex-col gap-5 p-6">
            <div className="grid gap-4 sm:grid-cols-4">
              <Detail label="Contó" value={count.volunteer_name} />
              <Detail label="Testigo 1" value={count.witness_1_name} />
              <Detail label="Testigo 2" value={count.witness_2_name} />
              <Detail label="Sobres" value={String(count.envelopes_count)} />
            </div>

            {(lines ?? []).length === 0 ? (
              <p className="text-sm text-zinc-500">El acta se cerró sin billetes cargados.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {(lines ?? [])
                  .slice()
                  .sort(
                    (a, b) =>
                      a.currency_code.localeCompare(b.currency_code) ||
                      Number(b.denomination_value) - Number(a.denomination_value),
                  )
                  .map((line) => (
                    <div
                      key={line.id}
                      className="grid grid-cols-[1fr_4rem_8rem] items-center gap-2 rounded-lg px-1 py-0.5 text-sm odd:bg-zinc-50"
                    >
                      <span className="text-zinc-900">
                        {formatMoney(Number(line.denomination_value), line.currency_code)}
                      </span>
                      <span className="text-center tabular-nums text-zinc-500">
                        × {line.quantity}
                      </span>
                      <span className="text-right tabular-nums text-zinc-900">
                        {formatMoney(Number(line.subtotal), line.currency_code)}
                      </span>
                    </div>
                  ))}
              </div>
            )}

            <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-zinc-200 pt-4">
              <span className="text-sm font-medium text-zinc-500">Total contado</span>
              <span className="text-xl font-semibold tabular-nums text-zinc-900">
                {formatTotals(countTotals)}
              </span>
            </div>

            {count.notes ? <p className="text-sm text-zinc-600">{count.notes}</p> : null}

            {count.status === 'finalized' ? (
              count.pdf_path ? (
                <a
                  href={`/${slug}/acta?path=${encodeURIComponent(count.pdf_path)}`}
                  className="text-sm font-medium text-zinc-900 hover:underline"
                >
                  Descargar el acta firmada (PDF)
                </a>
              ) : canWrite(role) ? (
                <ActionForm
                  action={generateCountActa}
                  submitLabel="Generar el PDF del acta"
                  submitVariant="secondary"
                >
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="sunday_id" value={sundayId} />
                  <input type="hidden" name="meeting_id" value={meetingId} />
                  <input type="hidden" name="count_id" value={count.id} />
                </ActionForm>
              ) : null
            ) : null}

            {count.status === 'finalized' && writes ? (
              <div className="border-t border-zinc-200 pt-4">
                <p className="mb-3 text-xs text-zinc-500">
                  Un acta finalizada no se edita. Si hay un error, se anula y se carga una nueva
                  con el motivo asentado.
                </p>
                <ActionForm
                  action={voidCount}
                  submitLabel="Anular acta"
                  submitVariant="danger"
                  fieldsClassName="flex flex-wrap items-end gap-3"
                >
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="meeting_id" value={meetingId} />
                  <input type="hidden" name="count_id" value={count.id} />
                  <Field label="Motivo">
                    <Input
                      name="voided_reason"
                      className="w-72"
                      placeholder="Se contó dos veces el mismo sobre"
                      required
                    />
                  </Field>
                </ActionForm>
              </div>
            ) : null}
          </Card>
        )}

        {writes && !count ? (
          <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4">
            <p className="text-xs font-medium text-zinc-500">
              Link para el voluntario (no necesita cuenta)
            </p>
            <CopyField value={`${origin}/r/${meeting.public_id}`} />
          </div>
        ) : null}
      </section>

      {/* ---------- Ventas ---------- */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-zinc-900">Ventas</h2>
          {session ? (
            <Badge tone={session.status === 'closed' ? 'green' : 'amber'}>
              {session.status === 'closed' ? 'Caja cerrada' : 'Caja abierta'} ·{' '}
              {session.seller_name}
            </Badge>
          ) : null}
        </div>

        {writes && (!session || session.status === 'open') ? (
          <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4">
            <p className="text-xs font-medium text-zinc-500">
              Link para quien vende (no necesita cuenta)
            </p>
            <CopyField value={`${origin}/v/${meeting.sales_public_id}`} />
          </div>
        ) : null}

        {session?.pdf_path ? (
          <a
            href={`/${slug}/acta?path=${encodeURIComponent(session.pdf_path)}`}
            className="text-sm font-medium text-zinc-900 hover:underline"
          >
            Descargar el cierre de caja (PDF)
          </a>
        ) : null}

        {(sales ?? []).length === 0 ? (
          <EmptyState title="No hay ventas cargadas en esta reunión." />
        ) : (
          <Card className="divide-y divide-zinc-100">
            {(sales ?? []).map((sale) => {
              const line = (saleLines ?? []).find((l) => l.sale_id === sale.id);
              return (
                <div
                  key={sale.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                >
                  <div>
                    <p className="text-sm text-zinc-900">
                      {line ? `${line.quantity} × ${line.product_name}` : 'Venta'}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {methodLabel(sale.payment_method)}
                      {sale.seller_name ? ` · ${sale.seller_name}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm tabular-nums text-zinc-900">
                      {formatMoney(Number(line?.subtotal ?? 0), sale.currency_code)}
                    </span>
                    {writes ? (
                      <form action={deleteSale}>
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="meeting_id" value={meetingId} />
                        <input type="hidden" name="id" value={sale.id} />
                        <SubmitButton variant="ghost">Borrar</SubmitButton>
                      </form>
                    ) : null}
                  </div>
                </div>
              );
            })}

            <div className="flex flex-wrap items-baseline justify-between gap-3 px-5 py-3">
              <span className="text-sm font-medium text-zinc-500">Total de ventas</span>
              <div className="text-right">
                <p className="text-sm font-semibold tabular-nums text-zinc-900">
                  {formatTotals(salesTotals.total)}
                </p>
                {salesMethods.length > 0 ? (
                  <p className="text-xs text-zinc-500">
                    {salesMethods
                      .map(
                        (method) =>
                          `${methodLabel(method)} ${formatTotals(salesTotals.byMethod[method])}`,
                      )
                      .join(' · ')}
                  </p>
                ) : null}
              </div>
            </div>
          </Card>
        )}

        {writes ? (
          (products ?? []).length === 0 ? (
            <p className="text-xs text-zinc-500">
              Para cargar ventas primero definí los productos en{' '}
              <Link
                href={`/${slug}/configuracion/productos`}
                className="font-medium text-zinc-900 hover:underline"
              >
                Configuración → Productos
              </Link>
              .
            </p>
          ) : (
            <Card className="p-5">
              <ActionForm
                action={addSale}
                submitLabel="Agregar venta"
                resetOnSuccess
                fieldsClassName="flex flex-wrap items-end gap-3"
              >
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="meeting_id" value={meetingId} />
                <Field label="Producto">
                  <Select name="product_id" className="w-56">
                    {(products ?? []).map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name} — {formatMoney(Number(product.price), product.currency_code)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Cantidad">
                  <Input name="quantity" type="number" min={1} defaultValue={1} className="w-24" />
                </Field>
                <Field label="Pago">
                  <Select name="payment_method" defaultValue="cash" className="w-40">
                    <option value="cash">Efectivo</option>
                    <option value="mercadopago">MercadoPago</option>
                  </Select>
                </Field>
                <Field label="Vendió">
                  <Input name="seller_name" className="w-44" />
                </Field>
              </ActionForm>
            </Card>
          )
        ) : null}
      </section>

      {/* ---------- Ingresos digitales ---------- */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-zinc-900">Ingresos por MercadoPago</h2>

        {(incomes ?? []).length === 0 ? (
          <EmptyState title="No hay ingresos digitales en esta reunión." />
        ) : (
          <Card className="divide-y divide-zinc-100">
            {(incomes ?? []).map((income) => (
              <div
                key={income.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div>
                  <p className="text-sm tabular-nums text-zinc-900">
                    {formatMoney(Number(income.amount), income.currency_code)}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {income.reference ? `Ref. ${income.reference}` : 'Sin referencia'}
                    {income.created_by_name ? ` · ${income.created_by_name}` : ''}
                  </p>
                </div>
                {writes ? (
                  <form action={deleteIncome}>
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="meeting_id" value={meetingId} />
                    <input type="hidden" name="id" value={income.id} />
                    <SubmitButton variant="ghost">Borrar</SubmitButton>
                  </form>
                ) : null}
              </div>
            ))}
          </Card>
        )}

        {writes ? (
          <Card className="p-5">
            <ActionForm
              action={addIncome}
              submitLabel="Agregar ingreso"
              resetOnSuccess
              fieldsClassName="flex flex-wrap items-end gap-3"
            >
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="meeting_id" value={meetingId} />
              <Field label="Monto">
                <Input name="amount" inputMode="decimal" className="w-36" required />
              </Field>
              <Field label="Moneda">
                <Select
                  name="currency_code"
                  defaultValue={organization.default_currency}
                  className="w-28"
                >
                  <option value="ARS">ARS</option>
                  <option value="USD">USD</option>
                </Select>
              </Field>
              <Field label="Referencia">
                <Input name="reference" className="w-44" placeholder="ID de la operación" />
              </Field>
              <Field label="Cargó">
                <Input name="created_by_name" className="w-40" />
              </Field>
            </ActionForm>
          </Card>
        ) : null}
      </section>

      {/* ---------- Actas anuladas ---------- */}
      {(voided ?? []).length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-zinc-900">Actas anuladas</h2>
          <Card className="divide-y divide-zinc-100">
            {(voided ?? []).map((old) => (
              <div key={old.id} className="px-5 py-3">
                <p className="text-sm text-zinc-900">{old.voided_reason}</p>
                <p className="text-xs text-zinc-500">
                  Contó {old.volunteer_name ?? '—'} · anulada el{' '}
                  {new Date(old.updated_at).toLocaleDateString('es-AR')}
                </p>
              </div>
            ))}
          </Card>
        </section>
      ) : null}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p className="text-sm text-zinc-900">{value || '—'}</p>
    </div>
  );
}
