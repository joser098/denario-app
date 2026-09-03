'use client';

import { useActionState, useRef, useState } from 'react';
import { EXPENSE_FIELDS, REVENUE_FIELDS, formatPercent, type ReportField } from '@/lib/reports';
import { formatMoney, parseAmount, toAmountInput } from '@/lib/money';
import { EMPTY_STATE, type FormState } from '@/lib/forms';
import { ConfirmDialog } from '@/components/form';
import { MoneyInput } from '@/components/money-input';
import { Alert, Button, Card } from '@/components/ui';
import type { PlReport } from '@/lib/database.types';

/**
 * El Profit & Loss de un domingo.
 *
 * Diecisiete campos que se cargan de una sentada copiando de una planilla, y
 * el objetivo es que entren todos en pantalla: tener que bajar a mirar el
 * superávit mientras se tipea arriba es justo lo que hace que no se note un
 * error de columna.
 *
 * Por eso el nombre va ARRIBA del campo y no al lado. Al lado, cada renglón
 * era un nombre corto y treinta centímetros de aire hasta el número, y los
 * nombres largos ("Apoyo a la operación de la iglesia HF…") envolvían de
 * forma impredecible, así que cada fila medía distinto.
 *
 * Los totales se recalculan mientras se tipea: uno que aparece recién después
 * de guardar llega tarde para lo que sirve.
 */
export function ReportForm({
  save,
  close,
  slug,
  report,
  readOnly,
}: {
  save: (prev: FormState, data: FormData) => Promise<FormState>;
  close: (prev: FormState, data: FormData) => Promise<FormState>;
  slug: string;
  report: PlReport;
  readOnly: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      [...REVENUE_FIELDS, ...EXPENSE_FIELDS].map((field) => [
        field.key,
        toAmountInput(report[field.key]),
      ]),
    ),
  );
  const [attendance, setAttendance] = useState(() => toAmountInput(report.attendance));
  const [participants, setParticipants] = useState(() => toAmountInput(report.participants));
  const [salvations, setSalvations] = useState(() => toAmountInput(report.salvations));

  const confirmClose = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(save, EMPTY_STATE);
  const [closeState, closeAction, closing] = useActionState(close, EMPTY_STATE);
  const feedback = closeState.error || closeState.message ? closeState : state;

  const num = (raw: string) => {
    const parsed = parseAmount(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };

  const sum = (fields: ReportField[]) =>
    fields.reduce((total, field) => total + num(values[field.key] ?? ''), 0);

  const currency = report.currency_code;
  const revenue = sum(REVENUE_FIELDS);
  const globalContribution = revenue * Number(report.global_rate);
  const continentalContribution = revenue * Number(report.continental_rate);
  const expenses = sum(EXPENSE_FIELDS) + globalContribution + continentalContribution;
  const surplus = revenue - expenses;

  const people = num(attendance);
  const joined = num(participants);
  const souls = num(salvations);

  const amounts = (fields: ReportField[]) =>
    fields.map((field) => (
      <Cell key={field.key} es={field.es} en={field.en}>
        <MoneyInput
          name={field.key}
          defaultValue={report[field.key]}
          onValueChange={(next) => setValues((prev) => ({ ...prev, [field.key]: next }))}
          disabled={readOnly}
          compact
          className="text-right tabular-nums"
        />
      </Cell>
    ));

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="id" value={report.id} />

      {feedback.error ? <Alert tone="error">{feedback.error}</Alert> : null}
      {feedback.message ? <Alert tone="success">{feedback.message}</Alert> : null}

      <fieldset disabled={pending || closing} className="flex flex-col gap-4 border-0 p-0">
        <div className="grid items-start gap-4 lg:grid-cols-5">
          {/* ---------- Ingresos ---------- */}
          <Card className="flex flex-col gap-2.5 p-4 lg:col-span-2">
            <Heading>Ingresos (Revenue)</Heading>

            <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2">{amounts(REVENUE_FIELDS)}</div>

            <TotalBar
              label="Total de ingresos (Total Revenue)"
              value={formatMoney(revenue, currency)}
            />

            <div className="grid gap-x-3 gap-y-2 border-t border-zinc-100 pt-3 sm:grid-cols-3">
              <Cell es="Asistencia" en="Sunday Attendance">
                <MoneyInput
                  name="attendance"
                  defaultValue={report.attendance}
                  onValueChange={setAttendance}
                  disabled={readOnly}
                  compact
                  className="text-right tabular-nums"
                />
              </Cell>
              <Cell es="Participación" en="Total Participation">
                <MoneyInput
                  name="participants"
                  defaultValue={report.participants}
                  onValueChange={setParticipants}
                  disabled={readOnly}
                  compact
                  className="text-right tabular-nums"
                />
              </Cell>
              <Derived
                es="% de participación"
                en="Participation %"
                value={formatPercent(people > 0 ? joined / people : null)}
              />
            </div>

            {joined > people ? (
              <Alert tone="error">
                Los que participaron no pueden ser más que los que asistieron.
              </Alert>
            ) : null}
          </Card>

          {/* ---------- Egresos ---------- */}
          <Card className="flex flex-col gap-2.5 p-4 lg:col-span-3">
            <Heading>Egresos (Expenses)</Heading>

            {/* Las dos contribuciones no se cargan: son un porcentaje del total
                de ingresos y se mueven solas al cambiar cualquier ingreso. */}
            <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
              <Derived
                es="Contribución global"
                en={`Global Contribution ${percent(report.global_rate)}`}
                value={formatMoney(globalContribution, currency)}
              />
              <Derived
                es="Contribución continental"
                en={`Continental Contribution ${percent(report.continental_rate)}`}
                value={formatMoney(continentalContribution, currency)}
              />
              {amounts(EXPENSE_FIELDS)}
            </div>

            <TotalBar
              label="Total de egresos (Total Expenses)"
              value={formatMoney(expenses, currency)}
            />

            <div className="grid gap-x-3 gap-y-2 border-t border-zinc-100 pt-3 sm:grid-cols-2">
              <Cell es="Salvaciones" en="Salvations">
                <MoneyInput
                  name="salvations"
                  defaultValue={report.salvations}
                  onValueChange={setSalvations}
                  disabled={readOnly}
                  compact
                  className="text-right tabular-nums"
                />
              </Cell>
              <Derived
                es="Costo por alma salvada"
                en="Cost per Soul"
                value={souls > 0 ? formatMoney(expenses / souls, currency) : '—'}
              />
            </div>
          </Card>
        </div>

        {/* ---------- Resultado ---------- */}
        <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <span className="text-sm font-semibold text-navy-900">
            {surplus < 0 ? 'Déficit (Deficit)' : 'Superávit (Surplus)'}
          </span>
          <span
            className={`text-xl font-semibold tabular-nums ${
              surplus < 0 ? 'text-red-600' : 'text-zinc-900'
            }`}
          >
            {formatMoney(surplus, currency)}
          </span>
        </Card>

        {readOnly ? null : (
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? 'Guardando…' : 'Guardar'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={closing}
              onClick={() => confirmClose.current?.showModal()}
            >
              {closing ? 'Cerrando…' : 'Guardar y cerrar'}
            </Button>
          </div>
        )}
      </fieldset>

      {/* El submit que cierra vive en el diálogo: así el botón de afuera solo
          pregunta, y confirmar es un submit común con su propia acción. */}
      <ConfirmDialog
        dialog={confirmClose}
        message="Al cerrarlo no se puede editar más. ¿Seguimos?"
        formAction={closeAction}
        variant="primary"
      />
    </form>
  );
}

/** 0.05 -> "5%" */
function percent(rate: number): string {
  return `${Number((Number(rate) * 100).toFixed(2))}%`;
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wide text-navy-900">{children}</h2>
  );
}

/**
 * Un campo: el nombre en dos renglones cortos y el monto abajo.
 *
 * El inglés va en su propia línea y no entre paréntesis al final del
 * castellano, para que todas las celdas midan lo mismo: en un solo párrafo,
 * "Otras donaciones" ocupaba una línea y "Pagos de préstamos de
 * instalaciones (Facilities Loan Repayments)" tres.
 */
function Cell({ es, en, children }: { es: string; en: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-xs font-medium leading-none text-zinc-700">{es}</span>
      <span className="mb-0.5 text-[10px] leading-none text-zinc-500">{en}</span>
      {children}
    </label>
  );
}

/** Lo mismo pero calculado: mismo alto, sin input. */
function Derived({ es, en, value }: { es: string; en: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium leading-none text-zinc-600">{es}</span>
      <span className="mb-0.5 text-[10px] leading-none text-zinc-500">{en}</span>
      <span className="flex h-8 items-center justify-end rounded-lg bg-zinc-100 px-2.5 text-sm font-medium tabular-nums text-zinc-900">
        {value}
      </span>
    </div>
  );
}

function TotalBar({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-navy-900 px-3 py-2">
      <span className="text-xs font-medium text-white/80">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-white">{value}</span>
    </div>
  );
}
