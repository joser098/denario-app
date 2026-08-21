import { redirect } from 'next/navigation';
import Link from 'next/link';
import { listOrganizations, requireUser } from '@/lib/auth';
import { signOut } from '@/lib/actions/auth';
import { Button, Card } from '@/components/ui';

/**
 * Puerta de entrada: manda a la unica organizacion del usuario, al onboarding
 * si no tiene ninguna, o al selector si tiene varias.
 */
export default async function HomePage() {
  const user = await requireUser();
  const organizations = await listOrganizations();

  if (organizations.length === 0) redirect('/nueva-organizacion');
  if (organizations.length === 1) redirect(`/${organizations[0].slug}`);

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-center text-2xl font-semibold tracking-tight text-zinc-900">
          Denario
        </h1>
        <p className="mb-8 text-center text-sm text-zinc-500">{user.email}</p>

        <Card className="divide-y divide-zinc-100">
          {organizations.map((org) => (
            <Link
              key={org.id}
              href={`/${org.slug}`}
              className="flex items-center justify-between px-4 py-3 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              {org.name}
              <span className="text-zinc-400">→</span>
            </Link>
          ))}
        </Card>

        <form action={signOut} className="mt-6 flex justify-center">
          <Button variant="ghost" type="submit">
            Cerrar sesión
          </Button>
        </form>
      </div>
    </div>
  );
}
