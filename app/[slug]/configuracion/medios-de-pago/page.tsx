import { requireOrg } from '@/lib/auth';
import {
  createPaymentMethod,
  movePaymentMethod,
  togglePaymentMethod,
  updatePaymentMethod,
} from '@/lib/actions/settings';
import { createClient } from '@/lib/supabase/server';
import { ActionForm, SubmitButton } from '@/components/form';
import { ModalButton } from '@/components/modal';
import { MoveButtons } from '@/components/reorder';
import { Badge, Card, EmptyState, Field, Input } from '@/components/ui';

export default async function PaymentMethodsSettingsPage(
  props: PageProps<'/[slug]/configuracion/medios-de-pago'>,
) {
  const { slug } = await props.params;
  const { organization } = await requireOrg(slug);

  const supabase = await createClient();
  const { data: methods } = await supabase
    .from('payment_methods')
    .select('*')
    .eq('organization_id', organization.id)
    .order('sort_order');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-2xl text-sm text-zinc-500">
          Con qué se paga un presupuesto. Cada iglesia les pone el nombre que usa: “Transferencia
          Macro”, “Tarjeta de la comisión”, lo que sea.
        </p>
        <ModalButton label="Agregar medio de pago" title="Agregar medio de pago">
          <ActionForm
            action={createPaymentMethod}
            submitLabel="Agregar medio de pago"
            resetOnSuccess
          >
            <input type="hidden" name="slug" value={slug} />
            <Field label="Medio de pago">
              <Input name="name" required placeholder="Transferencia Macro" autoFocus />
            </Field>
          </ActionForm>
        </ModalButton>
      </div>

      {(methods ?? []).length === 0 ? (
        <EmptyState title="Todavía no cargaste medios de pago." />
      ) : (
        <Card className="divide-y divide-zinc-100">
          {(methods ?? []).map((method, index) => (
            <div key={method.id} className="flex flex-wrap items-end justify-between gap-4 p-4">
              <ActionForm
                action={updatePaymentMethod}
                submitLabel="Guardar"
                submitVariant="secondary"
                fieldsClassName="flex flex-wrap items-end gap-3"
              >
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="id" value={method.id} />
                <Field label="Medio de pago">
                  <Input name="name" defaultValue={method.name} className="w-64" required />
                </Field>
              </ActionForm>

              <div className="flex items-center gap-3">
                <MoveButtons
                  action={movePaymentMethod}
                  fields={{ slug, id: method.id }}
                  first={index === 0}
                  last={index === (methods ?? []).length - 1}
                />
                {method.is_active ? null : <Badge tone="neutral">Inactivo</Badge>}
                <form action={togglePaymentMethod}>
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="id" value={method.id} />
                  <input type="hidden" name="active" value={method.is_active ? '0' : '1'} />
                  <SubmitButton variant="ghost">
                    {method.is_active ? 'Desactivar' : 'Activar'}
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
