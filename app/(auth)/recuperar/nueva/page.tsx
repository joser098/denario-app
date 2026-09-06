import { updatePassword } from '@/lib/actions/auth';
import { ActionForm } from '@/components/form';
import { Field, Input } from '@/components/ui';

export const metadata = { title: 'Nueva contraseña' };

/** Destino del link del mail de recuperacion, ya con la sesion canjeada. */
export default function NewPasswordPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight text-navy-900">Nueva contraseña</h1>

      <ActionForm action={updatePassword} submitLabel="Guardar contraseña">
        <Field label="Nueva contraseña" hint="Mínimo 8 caracteres.">
          <Input name="password" type="password" autoComplete="new-password" required autoFocus />
        </Field>
        <Field label="Repetir contraseña">
          <Input name="password2" type="password" autoComplete="new-password" required />
        </Field>
      </ActionForm>
    </div>
  );
}
