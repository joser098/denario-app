import type { NextConfig } from 'next';

// El logo de cada organizacion vive en el bucket publico de Supabase; hay que
// habilitar ese host para que <Image> pueda servirlo.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseHost = supabaseUrl ? new URL(supabaseUrl).hostname : null;

/**
 * Politica de seguridad de contenido.
 *
 * La app no carga scripts de terceros: todo el JS sale del mismo origen y lo
 * unico externo son las imagenes del bucket de Supabase y las llamadas a su
 * API. Por eso la lista puede ser corta y estricta.
 *
 * `'unsafe-inline'` en script-src es la concesion que pide Next para el
 * bootstrap del cliente; sin nonce por request no se puede evitar, y ponerlo
 * es mejor que no tener CSP.
 */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  `img-src 'self' data: blob:${supabaseHost ? ` https://${supabaseHost}` : ''}`,
  `connect-src 'self'${supabaseUrl ? ` ${supabaseUrl} wss://${supabaseHost}` : ''}`,
].join('; ');

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

  // Una app de tesoreria con links publicos: lo que mas pesa es que no se
  // pueda embeber en un iframe ajeno (clickjacking sobre "Aprobar" o "Pagar")
  // y que el navegador no adivine tipos de contenido.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Ninguna pantalla usa camara, microfono ni ubicacion.
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        ],
      },
    ];
  },

  experimental: {
    serverActions: {
      // Los archivos (logo, comprobantes) suben por Server Action, y el limite
      // por defecto es 1 MB: sin esto, el request se rechaza con 413 antes de
      // que la accion corra y el usuario nunca ve el mensaje de "muy grande".
      //
      // El limite es global — Next no lo deja poner por accion — asi que lo
      // ajustamos al techo real: 10 MB de adjunto mas el overhead de multipart.
      // Cada accion que recibe archivos valida el tamaño de nuevo por su
      // cuenta, que es lo que evita que este numero sea la unica defensa.
      bodySizeLimit: '11mb',
    },
  },
};

export default nextConfig;
