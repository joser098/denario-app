import Link from 'next/link';
import { Card } from '@/components/ui';

/**
 * Lo que ve alguien que abre un domingo, una semana o un reporte que no
 * existe — o que es de otro campus, que para él es lo mismo. Antes caía en el
 * 404 genérico de Next, sin forma de volver.
 */
export default function NotFound() {
  return (
    <Card className="flex flex-col items-start gap-3 p-6">
      <h1 className="text-lg font-semibold text-navy-900">Eso no existe</h1>
      <p className="text-sm text-zinc-600">
        El link puede estar viejo, o ser de un campus que no es el tuyo.
      </p>
      <Link href="./" className="text-sm font-medium text-brand-600 hover:underline">
        Volver
      </Link>
    </Card>
  );
}
