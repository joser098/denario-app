import Link from 'next/link';
import { signIn } from '@/lib/actions/auth';
import { ActionForm } from '@/components/form';
import { Alert, Field, Input } from '@/components/ui';

const LINK_ERRORS: Record<string, string> = {
  'link-invalido': 'Ese link no es válido. Pedí uno nuevo.',
  'link-vencido': 'Ese link ya venció o se usó. Pedí uno nuevo.',
};

export const metadata = { title: 'Ingresar · Denario' };

export default async function LoginPage(props: PageProps<'/login'>) {
  const { next, error } = await props.searchParams;
  const linkError = typeof error === 'string' ? LINK_ERRORS[error] : undefined;
  const nextPath = typeof next === 'string' ? next : '/';
  // Cruzar a "Crear cuenta" no puede perder el destino: si viniste de una
  // invitacion y lo perdes, al entrar caes en /nueva-organizacion.
  const signupHref =
    nextPath === '/' ? '/signup' : `/signup?next=${encodeURIComponent(nextPath)}`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-navy-900">Iniciar sesión</h1>
        <p className="mt-1 text-sm text-zinc-500">Entrá con tu cuenta de la tesorería.</p>
      </div>

      {linkError ? <Alert tone="error">{linkError}</Alert> : null}

      <ActionForm
        action={signIn}
        submitLabel="Entrar"
        footer={
          <div className="flex justify-between text-sm">
            <Link href="/recuperar" className="text-zinc-500 hover:text-zinc-900">
              Olvidé mi contraseña
            </Link>
            <Link href={signupHref} className="font-medium text-zinc-900 hover:underline">
              Crear cuenta
            </Link>
          </div>
        }
      >
        <input type="hidden" name="next" value={nextPath} />
        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" required autoFocus />
        </Field>
        <Field label="Contraseña">
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>
      </ActionForm>
    </div>
  );
}
