import type { Campus, PlReport } from '@/lib/database.types';

/**
 * El Profit & Loss report que cada campus manda el miercoles.
 *
 * Los renglones se declaran una sola vez y de aca salen el formulario, los
 * totales y el PDF: si alguien agrega un renglon en tres lugares distintos,
 * tarde o temprano el PDF y la pantalla dicen cosas distintas.
 *
 * Cada renglon lleva su nombre en ingles porque el reporte se manda a HF y
 * alla se lee asi; el castellano es para quien lo carga.
 */
export type ReportField = {
  key: RevenueKey | ExpenseKey | FoundationKey;
  es: string;
  en: string;
};

export type RevenueKey =
  | 'rev_tithes_offerings'
  | 'rev_hf_operation_support'
  | 'rev_other_donations'
  | 'rev_conferences_events'
  | 'rev_commercial_activities'
  | 'rev_other_income';

export type ExpenseKey =
  | 'exp_personnel'
  | 'exp_program'
  | 'exp_administration'
  | 'exp_facilities'
  | 'exp_facilities_loans'
  | 'exp_conferences_events'
  | 'exp_commercial_activities'
  | 'exp_assets_purchased'
  | 'exp_depreciation';

export type FoundationKey =
  | 'fnd_opening_balance'
  | 'fnd_income'
  | 'fnd_missional_expenses'
  | 'fnd_church_operation_support'
  | 'fnd_capital_expenditure';

export const REVENUE_FIELDS: ReportField[] = [
  { key: 'rev_tithes_offerings', es: 'Diezmos y ofrendas', en: 'Tithes and Offerings' },
  {
    key: 'rev_hf_operation_support',
    es: 'Apoyo a la operación de la iglesia HF',
    en: 'HF Church Operation Support',
  },
  { key: 'rev_other_donations', es: 'Otras donaciones', en: 'Other Donations' },
  { key: 'rev_conferences_events', es: 'Conferencias y eventos', en: 'Conferences & Events' },
  {
    key: 'rev_commercial_activities',
    es: 'Actividades comerciales',
    en: 'Commercial Activities',
  },
  { key: 'rev_other_income', es: 'Otros ingresos', en: 'Other Income' },
];

/**
 * Los egresos que se cargan a mano. Las dos contribuciones no estan: salen
 * del total de ingresos por su porcentaje, asi que no son campos.
 */
export const EXPENSE_FIELDS: ReportField[] = [
  { key: 'exp_personnel', es: 'Gastos de personal', en: 'Personnel Expenses' },
  { key: 'exp_program', es: 'Costos de programas', en: 'Program Costs' },
  { key: 'exp_administration', es: 'Costos de administración', en: 'Administration Costs' },
  { key: 'exp_facilities', es: 'Costos de instalaciones', en: 'Facilities Costs' },
  {
    key: 'exp_facilities_loans',
    es: 'Pagos de préstamos de instalaciones',
    en: 'Facilities Loan Repayments',
  },
  { key: 'exp_conferences_events', es: 'Conferencias y eventos', en: 'Conferences & Events' },
  {
    key: 'exp_commercial_activities',
    es: 'Actividades comerciales',
    en: 'Commercial Activities',
  },
  { key: 'exp_assets_purchased', es: 'Compra de activos', en: 'Assets Purchased' },
  { key: 'exp_depreciation', es: 'Depreciación', en: 'Depreciation' },
];

/**
 * El presupuesto de la Fundacion.
 *
 * Es una seccion aparte: no entra en el total de ingresos ni en el de
 * egresos, ni en el superavit. Arranca del saldo inicial y cierra en el
 * final.
 *
 * Los cinco renglones SUMAN al saldo final. Todavia no esta definido cual
 * deberia restar, asi que los campos admiten negativos y quien carga pone el
 * signo. Cuando se decida, se cambia `foundationClosing` y nada mas.
 *
 * `fnd_church_operation_support` se llama igual que el ingreso
 * `rev_hf_operation_support` a proposito: son las dos patas de la misma
 * plata, lo que la Fundacion da y lo que la iglesia recibe.
 */
export const FOUNDATION_FIELDS: ReportField[] = [
  {
    key: 'fnd_opening_balance',
    es: 'Saldo inicial de la Fundación',
    en: 'Hillsong Foundation O/Bal',
  },
  { key: 'fnd_income', es: 'Ingresos de la Fundación', en: 'HF Income' },
  { key: 'fnd_missional_expenses', es: 'Gastos misionales', en: 'HF Missional Expenses' },
  {
    key: 'fnd_church_operation_support',
    es: 'Apoyo a la operación de la iglesia',
    en: 'HF Church Operation Support',
  },
  {
    key: 'fnd_capital_expenditure',
    es: 'Inversión en bienes de capital',
    en: 'HF Capital Expenditure',
  },
];

/** El renglon final de la seccion. No es un campo: se calcula. */
export const FOUNDATION_CLOSING: Omit<ReportField, 'key'> = {
  es: 'Saldo final de la Fundación',
  en: 'Hillsong Foundation C/Bal',
};

/** "Otras donaciones (Other Donations)" */
export function fieldLabel(field: ReportField): string {
  return `${field.es} (${field.en})`;
}

export const REPORT_STATUS_LABELS = {
  draft: 'Borrador',
  closed: 'Cerrado',
} as const;

export type ReportTotals = {
  revenue: number;
  /** Saldo final de la Fundacion (C/Bal). Aparte del superavit. */
  foundationClosing: number;
  globalContribution: number;
  continentalContribution: number;
  expenses: number;
  surplus: number;
  /** null cuando no hubo asistencia cargada: 0 de 0 no es 0%, es "no se sabe". */
  participation: number | null;
  costPerSoul: number | null;
};

const sum = (report: PlReport, fields: ReportField[]) =>
  fields.reduce((total, field) => total + Number(report[field.key] ?? 0), 0);

/**
 * Todo lo derivado del reporte, en un solo lugar.
 *
 * Las contribuciones se calculan sobre el total de ingresos con el
 * porcentaje guardado en la fila, no con una constante: un reporte cerrado
 * tiene que seguir dando lo mismo aunque HF cambie el porcentaje.
 */
export function reportTotals(report: PlReport): ReportTotals {
  const revenue = sum(report, REVENUE_FIELDS);
  const globalContribution = round(revenue * Number(report.global_rate));
  const continentalContribution = round(revenue * Number(report.continental_rate));
  const expenses = round(
    sum(report, EXPENSE_FIELDS) + globalContribution + continentalContribution,
  );

  return {
    revenue: round(revenue),
    // Por ahora los cinco suman. El dia que se defina cual resta, se cambia
    // esta linea sola.
    foundationClosing: round(sum(report, FOUNDATION_FIELDS)),
    globalContribution,
    continentalContribution,
    expenses,
    surplus: round(revenue - expenses),
    // Los que participaron sobre los que vinieron. Sin asistencia cargada el
    // porcentaje no existe, y mostrar 0% seria afirmar que no participo nadie.
    participation: report.attendance > 0 ? report.participants / report.attendance : null,
    // Un domingo sin salvaciones no tiene costo por alma infinito: no tiene.
    costPerSoul: report.salvations > 0 ? round(expenses / report.salvations) : null,
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function formatPercent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

// ============================================================
// Consolidado de la organizacion
// ============================================================

/**
 * Un campus dentro del consolidado. `unitsPerUsd` es null cuando falta la
 * cotizacion de esa moneda para ese domingo: sin ella el campus no se puede
 * sumar, y eso hay que decirlo — no descontarlo en silencio.
 */
export type ConsolidatedCampus = {
  campus: Pick<Campus, 'id' | 'name'>;
  report: PlReport | null;
  unitsPerUsd: number | null;
};

export type ConsolidatedRow = {
  field: ReportField;
  /** Por campus, en su moneda. */
  local: Record<string, number>;
  /** Por campus, en dolares. null si falta la cotizacion. */
  usd: Record<string, number | null>;
  total: number;
};

export type Consolidated = {
  revenue: ConsolidatedRow[];
  expenses: ConsolidatedRow[];
  totals: {
    revenue: number;
    globalContribution: number;
    continentalContribution: number;
    expenses: number;
    surplus: number;
    attendance: number;
    participants: number;
    salvations: number;
    participation: number | null;
    costPerSoul: number | null;
  };
  /** Campus que quedaron afuera de la suma, y por que. */
  missingRate: string[];
  missingReport: string[];
};

/** El dolar vale un dolar; el resto se divide por su cotizacion. */
export function toUsd(amount: number, unitsPerUsd: number | null): number | null {
  if (unitsPerUsd === null || unitsPerUsd <= 0) return null;
  return round(amount / unitsPerUsd);
}

/**
 * Junta los reportes de un domingo en un solo cuadro en dolares.
 *
 * Los montos se convierten; la gente no. Asistencia, participacion y
 * salvaciones se suman derecho, y los dos indicadores se recalculan sobre
 * esos totales — promediar los porcentajes de cada campus le daria el mismo
 * peso a uno de 50 personas que a uno de 2000.
 */
export function consolidate(items: ConsolidatedCampus[]): Consolidated {
  const contributing = items.filter((i) => i.report && i.unitsPerUsd !== null);

  const build = (fields: ReportField[]): ConsolidatedRow[] =>
    fields.map((field) => {
      const local: Record<string, number> = {};
      const usd: Record<string, number | null> = {};
      let total = 0;

      for (const item of items) {
        if (!item.report) continue;
        const amount = Number(item.report[field.key] ?? 0);
        local[item.campus.id] = amount;

        const converted = toUsd(amount, item.unitsPerUsd);
        usd[item.campus.id] = converted;
        if (converted !== null) total += converted;
      }

      return { field, local, usd, total: round(total) };
    });

  const revenue = build(REVENUE_FIELDS);
  const expenses = build(EXPENSE_FIELDS);

  const revenueTotal = round(revenue.reduce((sum, row) => sum + row.total, 0));

  // Las contribuciones se suman campus por campus y no se sacan del total en
  // dolares: cada uno puede tener su propio porcentaje guardado.
  let globalContribution = 0;
  let continentalContribution = 0;
  for (const item of contributing) {
    const own = reportTotals(item.report!);
    globalContribution += toUsd(own.globalContribution, item.unitsPerUsd) ?? 0;
    continentalContribution += toUsd(own.continentalContribution, item.unitsPerUsd) ?? 0;
  }
  globalContribution = round(globalContribution);
  continentalContribution = round(continentalContribution);

  const expensesTotal = round(
    expenses.reduce((sum, row) => sum + row.total, 0) +
      globalContribution +
      continentalContribution,
  );

  const attendance = contributing.reduce((n, i) => n + i.report!.attendance, 0);
  const participants = contributing.reduce((n, i) => n + i.report!.participants, 0);
  const salvations = contributing.reduce((n, i) => n + i.report!.salvations, 0);

  return {
    revenue,
    expenses,
    totals: {
      revenue: revenueTotal,
      globalContribution,
      continentalContribution,
      expenses: expensesTotal,
      surplus: round(revenueTotal - expensesTotal),
      attendance,
      participants,
      salvations,
      participation: attendance > 0 ? participants / attendance : null,
      costPerSoul: salvations > 0 ? round(expensesTotal / salvations) : null,
    },
    missingRate: items
      .filter((i) => i.report && i.unitsPerUsd === null)
      .map((i) => i.campus.name),
    missingReport: items.filter((i) => !i.report).map((i) => i.campus.name),
  };
}
