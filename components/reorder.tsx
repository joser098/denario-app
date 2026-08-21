import { SubmitButton } from '@/components/form';

/**
 * Flechas para mover un elemento en su lista. Reemplazan al viejo campo
 * "Orden": nadie deberia escribir un numero para decir que algo va antes
 * que otra cosa. La renumeracion la hace la accion.
 */
export function MoveButtons({
  action,
  fields,
  first,
  last,
}: {
  action: (formData: FormData) => void | Promise<void>;
  /** Campos ocultos que identifican la fila (slug, id, campus…). */
  fields: Record<string, string>;
  first: boolean;
  last: boolean;
}) {
  const hidden = Object.entries(fields).map(([name, value]) => (
    <input key={name} type="hidden" name={name} value={value} />
  ));

  return (
    <div className="flex gap-1">
      <form action={action}>
        {hidden}
        <input type="hidden" name="direction" value="up" />
        <SubmitButton className="w-9 px-0" disabled={first} title="Subir">
          ↑
        </SubmitButton>
      </form>
      <form action={action}>
        {hidden}
        <input type="hidden" name="direction" value="down" />
        <SubmitButton className="w-9 px-0" disabled={last} title="Bajar">
          ↓
        </SubmitButton>
      </form>
    </div>
  );
}
