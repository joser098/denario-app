import type { NextConfig } from 'next';

// El logo de cada organizacion vive en el bucket publico de Supabase; hay que
// habilitar ese host para que <Image> pueda servirlo.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseHost = supabaseUrl ? new URL(supabaseUrl).hostname : null;

const nextConfig: NextConfig = {
  images: supabaseHost
    ? {
        remotePatterns: [
          {
            protocol: 'https',
            hostname: supabaseHost,
            pathname: '/storage/v1/object/public/**',
          },
        ],
      }
    : undefined,
  experimental: {
    serverActions: {
      // Los archivos (logo, comprobantes) suben por Server Action, y el limite
      // por defecto es 1 MB: sin esto, el request se rechaza con 413 antes de
      // que la accion corra y el usuario nunca ve el mensaje de "muy grande".
      // El techo mas alto que aceptamos es 10 MB (comprobantes); el resto es
      // margen para el overhead de multipart.
      bodySizeLimit: '11mb',
    },
  },
};

export default nextConfig;
