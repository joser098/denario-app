/**
 * Lo que cambió en Denario, contado para quien lo usa.
 *
 * Vive en el código y no en la base a propósito: son notas de versión, no
 * datos de la iglesia. Se escriben junto con el cambio que describen y viajan
 * en el mismo deploy, así que no hay forma de que la pantalla diga que algo
 * salió antes de que salga.
 *
 * Se escribe en el idioma de quien lo lee: qué cambió y qué tiene que hacer
 * distinto, no cómo está hecho por dentro. Nada de nombres de tablas.
 */

export type ChangeKind = 'nuevo' | 'cambio' | 'mejora';

export const KIND_LABEL: Record<ChangeKind, string> = {
  nuevo: 'Nuevo',
  cambio: 'Cambio',
  mejora: 'Mejora',
};

export const KIND_TONE: Record<ChangeKind, 'green' | 'amber' | 'blue'> = {
  nuevo: 'green',
  cambio: 'amber',
  mejora: 'blue',
};

export type Change = {
  kind: ChangeKind;
  /** La pantalla donde se ve. */
  area: string;
  title: string;
  detail: string;
  /** Qué hay que hacer distinto, cuando hay algo. */
  action?: string;
};

export type Release = {
  /** yyyy-mm-dd. */
  date: string;
  changes: Change[];
};

/** De la más nueva a la más vieja: lo último es lo que se viene a mirar. */
export const CHANGELOG: Release[] = [
  {
    date: '2026-09-10',
    changes: [
      {
        kind: 'nuevo',
        area: 'Profit & Loss',
        title: 'Se agregó la sección Foundation Budget',
        detail:
          'El presupuesto de la Fundación, con sus cinco renglones —saldo inicial, ingresos, gastos misionales, apoyo a la operación de la iglesia e inversión en bienes de capital— y el saldo final calculado. Va aparte del superávit y también sale impreso en el PDF que se manda a HF.',
        action:
          'Por ahora los cinco renglones suman al saldo final. El que tenga que restar, cargalo en negativo, con el signo menos adelante.',
      },
      {
        kind: 'cambio',
        area: 'Semanal y Gastos',
        title: 'Los períodos ya no se abren solos',
        detail:
          'Antes, entregar una compra o marcar un pago como pagado abría la semana automáticamente si todavía no existía. Ahora no: si la fecha del gasto no cae dentro de ningún período abierto, la operación se corta y te avisa cuál falta.',
        action:
          'Abrí el período en Semanal antes de registrar gastos. Si te frena un pago o una entrega, es esto.',
      },
      {
        kind: 'cambio',
        area: 'Semanal',
        title: 'El período del libro lo elegís vos',
        detail:
          'El libro semanal iba siempre de martes a lunes. Ahora se abre con dos fechas, Desde y Hasta: una semana, una quincena, un mes, lo que necesites. Lo único que no se puede es que dos períodos del mismo campus se pisen.',
      },
      {
        kind: 'nuevo',
        area: 'Actas',
        title: 'Una pantalla con todas las actas juntas',
        detail:
          'Conteo de ofrenda, caja de ventas y cierre del domingo, en una sola lista ordenada por fecha y con filtro por rango. Cada acta se puede abrir con Ver, sin bajar el archivo, o descargar como siempre. La ven quienes administran la organización; el acta de cada reunión se sigue bajando desde Domingos.',
      },
      {
        kind: 'cambio',
        area: 'Actas de conteo',
        title: 'El acta ahora lleva declaración jurada y el documento de quien firma',
        detail:
          'Arriba de las firmas se imprime una declaración jurada, y al lado de cada firma quedó un renglón en blanco para escribir el documento a mano al momento de firmar. Las actas ya firmadas no cambian: esto vale para las que se firmen de ahora en adelante.',
        action:
          'El tipo de documento sale del campus —DNI, CPF, CC, CI o CURP— y se elige en Configuración → Campus.',
      },
    ],
  },
];
