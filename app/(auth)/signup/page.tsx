import Link from 'next/link';
import { signUp } from '@/lib/actions/auth';
import { ActionForm } from '@/components/form';
import { Field, Input } from '@/components/ui';

export const metadata = { title: 'Crear cuenta · Denario' };

export default async function SignupPage(props: PageProps<'/signup'>) {
  const { next } = await props.searchParams;
  const nextPath = typeof next === 'string' ? next : '/';
  // Ver login/page.tsx: el cruce entre las dos pantallas conserva el destino.
  const loginHref =
    nextPath === '/' ? '/login' : `/login?next=${encodeURIComponent(nextPath)}`;

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
            <Link href={loginHref} className="font-medium text-zinc-900 hover:underline">
              Ingresar
            </Link>
          </p>
        }
      >
        <input type="hidden" name="next" value={nextPath} />
        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" required autoFocus />
        </Field>
        <Field label="Contraseña" hint="Mínimo 8 caracteres.">
          <Input name="password" type="password" autoComplete="new-password" required />
        </Field>
        <Field label="Repetir contraseña">
          <Input name="password2" type="password" autoComplete="new-password" required />
        </Field>
      </ActionForm>
    </div>
  );
}
