import { PageSkeleton } from '@/components/skeleton';

/**
 * Cubre todo lo que cuelga de /[slug]. El layout (sidebar, logo, menú) queda
 * pintado y solo el contenido muestra el esqueleto, que es lo que hace que
 * la navegación se sienta instantánea aunque las consultas tarden.
 */
export default function Loading() {
  return <PageSkeleton />;
}
