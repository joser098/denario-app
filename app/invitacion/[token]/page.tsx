import Link from 'next/link';
import { acceptInvitation } from '@/lib/actions/organizations';
import { getUser, ROLE_LABELS } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { ActionForm } from '@/components/form';
import { Alert } from '@/components/ui';

export const metadata = { title: 'Invitación · Denario' };

/**
 * Pantalla de aceptacion. La posesion del token es la autorizacion para ver
 * los datos (el RPC `invitation_preview` esta abierto a anon); aceptar exige
 * sesion y que el email coincida.
 */
export default async function InvitationPage(props: PageProps<'/invitacion/[token]'>) {
  const { token } = await props.params;

  const supabase = await createClient();
  const { data } = await supabase.rpc('invitation_preview', { p_token: token });
  const invitation = data?.[0];
  const user = await getUser();

  const shell = (children: React.ReactNode) => (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <p className="mb-8 text-center text-2xl font-semibold tracking-tight text-zinc-900">
          Denario
        </p>
        <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          {children}
        </div>
      </div>
    </div>
  );

  if (!invitation) {
    return shell(
      <>
        <Alert tone="error">Esta invitación no existe.</Alert>
        <Link href="/login" className="text-center text-sm text-zinc-500 hover:text-zinc-900">
          Ir a Denario
        </Link>
      </>,
    );
  }

  if (invitation.accepted) {
    return shell(
      <>
        <Alert tone="info">Esta invitación ya fue usada.</Alert>
        <Link href="/login" className="text-center text-sm text-zinc-500 hover:text-zinc-900">
          Ingresar
        </Link>
      </>,
    );
  }

  if (new Date(invitation.expires_at) < new Date()) {
    return shell(
      <>
        <Alert tone="error">Esta invitación venció. Pedile a un administrador que te mande otra.</Alert>
        <Link href="/login" className="text-center text-sm text-zinc-500 hover:text-zinc-900">
          Ingresar
        </Link>
      </>,
    );
  }

  const detail = (
    <div className="flex flex-col gap-1 text-sm">
      <p className="text-zinc-600">
        Te invitaron a <strong className="text-zinc-900">{invitation.organization_name}</strong> como{' '}
        <strong className="text-zinc-900">{ROLE_LABELS[invitation.role]}</strong>.
      </p>
      <p className="text-zinc-500">Para {invitation.email}</p>
    </div>
  );

  if (!user) {
    const next = `/invitacion/${token}`;
    return shell(
      <>
        {detail}
        <p className="text-sm text-zinc-500">
          Entrá con esa cuenta o creala para aceptar la invitación.
        </p>
        <div className="flex flex-col gap-2">
          <Link
            href={`/signup?next=${encodeURIComponent(next)}`}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700"
          >
            Crear cuenta
          </Link>
          <Link
            href={`/login?next=${encodeURIComponent(next)}`}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
          >
            Ya tengo cuenta
          </Link>
        </div>
      </>,
    );
  }

  if (user.email?.toLowerCase() !== invitation.email.toLowerCase()) {
    return shell(
      <>
        {detail}
        <Alert tone="error">
          Estás con la sesión de {user.email}. Cerrá sesión y entrá con {invitation.email}.
        </Alert>
      </>,
    );
  }

  return shell(
    <>
      {detail}
      <ActionForm action={acceptInvitation} submitLabel="Aceptar invitación">
        <input type="hidden" name="token" value={token} />
      </ActionForm>
    </>,
  );
}
