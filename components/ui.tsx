import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

/**
 * Piezas visuales compartidas. Son Server Components: no traen estado ni
 * eventos, solo clases. Lo interactivo vive en los formularios.
 */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-500 text-white hover:bg-brand-600 disabled:bg-brand-200',
  secondary:
    'border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 disabled:text-zinc-400',
  ghost: 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900',
  danger: 'bg-red-600 text-white hover:bg-red-500 disabled:bg-red-300',
};

export function buttonClass(variant: Variant = 'primary', extra = '') {
  return [
    'inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4',
    'text-sm font-medium transition-colors',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
    'disabled:cursor-not-allowed',
    VARIANTS[variant],
    extra,
  ].join(' ');
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ComponentProps<'button'> & { variant?: Variant }) {
  return <button {...props} className={buttonClass(variant, className)} />;
}

export function LinkButton({
  variant = 'secondary',
  className = '',
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link {...props} className={buttonClass(variant, className)} />;
}

export function Card({ className = '', ...props }: ComponentProps<'div'>) {
  return (
    <div
      {...props}
      className={`rounded-xl border border-zinc-200 bg-white shadow-sm ${className}`}
    />
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-zinc-700">{label}</span>
      {children}
      {hint ? <span className="text-xs text-zinc-500">{hint}</span> : null}
    </label>
  );
}

const CONTROL = [
  'h-10 w-full rounded-lg border border-zinc-300 bg-white px-3',
  'text-sm text-zinc-900 placeholder:text-zinc-500',
  'focus:border-brand-500 focus:ring-2 focus:ring-brand-100 focus:outline-none',
  'disabled:bg-zinc-100 disabled:text-zinc-500',
].join(' ');

/**
 * `compact` baja el alto de 40 a 36 y achica el padding. Es para las grillas
 * de carga —el Profit & Loss son diecisiete campos— donde cuatro pixeles por
 * fila son la diferencia entre entrar en pantalla y no entrar. No se puede
 * pisar con className: dos clases de alto compiten sin ganador previsible.
 */
const CONTROL_COMPACT = CONTROL.replace('h-10', 'h-8').replace('px-3', 'px-2.5');

export function Input({
  className = '',
  compact = false,
  ...props
}: ComponentProps<'input'> & { compact?: boolean }) {
  return <input {...props} className={`${compact ? CONTROL_COMPACT : CONTROL} ${className}`} />;
}

export function Select({ className = '', ...props }: ComponentProps<'select'>) {
  return <select {...props} className={`${CONTROL} ${className}`} />;
}

/**
 * Las opciones de un selector de moneda, a partir del catalogo.
 *
 * `long` para los formularios donde la moneda se elige una vez y conviene
 * leerla entera ("Peso colombiano (COP)"); el codigo solo para los selectores
 * angostos que van al lado de un monto.
 */
export function CurrencyOptions({
  currencies,
  long = false,
}: {
  currencies: Array<{ code: string; name: string }>;
  long?: boolean;
}) {
  return currencies.map((currency) => (
    <option key={currency.code} value={currency.code}>
      {long ? `${currency.name} (${currency.code})` : currency.code}
    </option>
  ));
}

export function Textarea({ className = '', ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      {...props}
      className={`${CONTROL.replace('h-10', 'min-h-20 py-2')} ${className}`}
    />
  );
}

const TONES = {
  error: 'border-red-200 bg-red-50 text-red-800',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  info: 'border-zinc-200 bg-zinc-50 text-zinc-700',
};

export function Alert({
  tone = 'info',
  children,
}: {
  tone?: keyof typeof TONES;
  children: ReactNode;
}) {
  if (!children) return null;
  // Un error interrumpe (`alert`); un exito o un aviso esperan a que el lector
  // termine lo que estaba diciendo (`status`).
  return (
    <p
      className={`rounded-lg border px-3 py-2 text-sm ${TONES[tone]}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {children}
    </p>
  );
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'blue' | 'green' | 'amber' | 'red';
  children: ReactNode;
}) {
  const tones = {
    neutral: 'bg-zinc-100 text-zinc-700',
    blue: 'bg-brand-100 text-brand-700',
    green: 'bg-emerald-100 text-emerald-800',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-800',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-navy-900">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-zinc-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </header>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
      <p className="text-sm font-medium text-zinc-900">{title}</p>
      {description ? <p className="max-w-sm text-sm text-zinc-500">{description}</p> : null}
      {action}
    </div>
  );
}
