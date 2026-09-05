import { requireAdminOrg } from '@/lib/auth';
import {
  createProduct,
  moveProduct,
  toggleProduct,
  updateProduct,
} from '@/lib/actions/settings';
import { createClient } from '@/lib/supabase/server';
import { listCurrencies } from '@/lib/currencies';
import { ActionForm, SubmitButton } from '@/components/form';
import { ModalButton } from '@/components/modal';
import { MoveButtons } from '@/components/reorder';
import { MoneyInput } from '@/components/money-input';
import { Badge, Card, CurrencyOptions, EmptyState, Field, Input, Select } from '@/components/ui';

export const metadata = { title: 'Productos' };

export default async function ProductsSettingsPage(
  props: PageProps<'/[slug]/configuracion/productos'>,
) {
  const { slug } = await props.params;
  const { organization } = await requireAdminOrg(slug);

  const supabase = await createClient();
  // En paralelo: son dos consultas que no dependen una de la otra.
  const [currencies, { data: products }] = await Promise.all([
    listCurrencies(supabase),
    supabase
      .from('products')
      .select('*')
      .eq('organization_id', organization.id)
      .order('sort_order'),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-2xl text-sm text-zinc-500">
          Lo que se vende en la reunión: libros, café, entradas. El precio queda guardado en
          cada venta, así que cambiarlo acá no toca las ventas ya cargadas.
        </p>
        <ModalButton label="Agregar producto" title="Agregar producto">
          <ActionForm action={createProduct} submitLabel="Agregar producto" resetOnSuccess>
            <input type="hidden" name="slug" value={slug} />
            <Field label="Producto">
              <Input name="name" required placeholder="Libro de estudio" />
            </Field>
            <Field label="Precio">
              <MoneyInput name="price" required placeholder="15.000" />
            </Field>
            <Field label="Moneda">
              <Select name="currency_code" defaultValue={organization.default_currency}>
                <CurrencyOptions currencies={currencies} long />
              </Select>
            </Field>
          </ActionForm>
        </ModalButton>
      </div>

      {(products ?? []).length === 0 ? (
        <EmptyState title="Todavía no cargaste productos." />
      ) : (
        <Card className="divide-y divide-zinc-100">
          {(products ?? []).map((product, index) => (
            <div key={product.id} className="flex flex-wrap items-end justify-between gap-4 p-4">
              <ActionForm
                action={updateProduct}
                submitLabel="Guardar"
                submitVariant="secondary"
                fieldsClassName="flex flex-wrap items-end gap-3"
              >
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="id" value={product.id} />
                <Field label="Producto">
                  <Input name="name" defaultValue={product.name} className="w-56" required />
                </Field>
                <Field label="Precio">
                  <MoneyInput
                    name="price"
                    defaultValue={product.price}
                    className="w-28 text-right"
                    required
                  />
                </Field>
                <Field label="Moneda">
                  <Select
                    name="currency_code"
                    defaultValue={product.currency_code}
                    className="w-28"
                  >
                    <CurrencyOptions currencies={currencies} />
                  </Select>
                </Field>
              </ActionForm>

              <div className="flex items-center gap-3">
                <MoveButtons
                  action={moveProduct}
                  fields={{ slug, id: product.id }}
                  first={index === 0}
                  last={index === (products ?? []).length - 1}
                />
                {product.is_active ? null : <Badge tone="neutral">Inactivo</Badge>}
                <form action={toggleProduct}>
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="id" value={product.id} />
                  <input type="hidden" name="active" value={product.is_active ? '0' : '1'} />
                  <SubmitButton variant="ghost">
                    {product.is_active ? 'Desactivar' : 'Activar'}
                  </SubmitButton>
                </form>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
