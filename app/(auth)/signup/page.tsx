import Link from 'next/link';
import { signUp } from '@/lib/actions/auth';
import { authHref, param } from '@/lib/auth-links';
import { ActionForm } from '@/components/form';
import { Field, Input } from '@/components/ui';

export const metadata = { title: 'Crear cuenta · Denario' };

export default async function SignupPage(props: PageProps<'/signup'>) {
  const { next, email } = await props.searchParams;
  const nextPath = param(next) ?? '/';
  // Ver login/page.tsx: viniendo de una invitacion el email no se elige.
  const invitedEmail = param(email);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-navy-900">Crear cuenta</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Con tu cuenta vas a poder crear la organización o aceptar una invitación.
        </p>
      </div>

      <ActionForm
        action={signUp}
        submitLabel="Crear cuenta"
        replaceOnSuccess
        footer={
          <p className="text-center text-sm text-zinc-500">
            ¿Ya tenés cuenta?{' '}
            <Link
              href={authHref('/login', nextPath, invitedEmail)}
              className="font-medium text-zinc-900 hover:underline"
            >
              Ingresar
            </Link>
          </p>
        }
      >
        <input type="hidden" name="next" value={nextPath} />
        <Field
          label="Email"
          hint={invitedEmail ? 'La invitación es para este email.' : undefined}
        >
          <Input
            name="email"
            type="email"
            autoComplete="email"
            required
            autoFocus={!invitedEmail}
            defaultValue={invitedEmail}
            readOnly={Boolean(invitedEmail)}
            className={invitedEmail ? 'bg-zinc-50 text-zinc-500' : ''}
          />
        </Field>
        <Field label="Contraseña" hint="Mínimo 8 caracteres.">
          <Input
            name="password"
            type="password"
            autoComplete="new-password"
            required
            autoFocus={Boolean(invitedEmail)}
          />
        </Field>
        <Field label="Repetir contraseña">
          <Input name="password2" type="password" autoComplete="new-password" required />
        </Field>
      </ActionForm>
    </div>
  );
}
