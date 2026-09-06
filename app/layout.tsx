import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  /*
   * Las pantallas de una organizacion traen su propio template desde
   * app/[slug]/layout.tsx ("%s · Hillsong"), que pisa a este. Este cubre el
   * resto: login, invitacion y las superficies publicas por token.
   */
  title: { default: 'Denario', template: '%s · Denario' },
  description: 'Tesorería de la iglesia: las ofrendas de cada domingo y el libro semanal, en un solo lugar.',
  applicationName: 'Denario',
  // Ni la tesoreria ni los links por token tienen nada que hacer en un buscador.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="es-AR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
