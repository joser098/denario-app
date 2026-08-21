import Link from 'next/link';
import { requestPasswordReset } from '@/lib/actions/auth';
import { ActionForm } from '@/components/form';
import { Field, Input } from '@/components/ui';

export const metadata = { title: 'Recuperar contraseña · Denario' };

export default function RecoverPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-navy-900">Recuperar contraseña</h1>
        <p className="mt-1 text-sm text-zinc-500">Te mandamos un link para elegir una nueva.</p>
      </div>

      <ActionForm
        action={requestPasswordReset}
        submitLabel="Enviar link"
        replaceOnSuccess
        footer={
          <p className="text-center text-sm">
            <Link href="/login" className="text-zinc-500 hover:text-zinc-900">
              Volver a ingresar
            </Link>
          </p>
        }
      >
        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" required autoFocus />
        </Field>
      </ActionForm>
    </div>
  );
}
