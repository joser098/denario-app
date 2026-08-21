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
};

export default nextConfig;
