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
    date: '2026-09-15',
    changes: [
      {
        kind: 'cambio',
        area: 'Domingos, Semanal y Profit & Loss',
        title: 'Los tres módulos ahora se alimentan entre sí',
        detail:
          'La plata se carga una sola vez y corre sola: al cerrar un domingo, su efectivo, lo digital y las ventas bajan al período del Semanal que lo contiene; al cerrar el período, sus totales bajan al Profit & Loss de ese campus. Se terminó tipear el mismo número tres veces.',
        action:
          'Si reabrís un domingo, sus movimientos salen del Semanal y vuelven cuando lo cerrás de nuevo. Un domingo no se puede cerrar si su fecha no cae en ningún período abierto.',
      },
      {
        kind: 'cambio',
        area: 'Semanal',
        title: 'El período lo abre un administrador, para todos los campus',
        detail:
          'Antes cada campus abría el suyo. Ahora un administrador elige desde y hasta una sola vez y el período se abre en todos los campus, cada uno con su Profit & Loss ya creado con esas mismas fechas.',
        action:
          'Si sos tesorero ya no abrís períodos: cargás adentro del que esté abierto. Pedile a un administrador que abra el que falte.',
      },
      {
        kind: 'cambio',
        area: 'Profit & Loss',
        title: 'El reporte ya no es de un domingo: cubre el período',
        detail:
          'Cada reporte tapa el mismo tramo de fechas que el período del Semanal del que sale. El consolidado también pasó a elegirse por período en vez de por domingo, y las cotizaciones se cargan por período.',
        action:
          'Los renglones que trae el Semanal vienen cargados pero se pueden corregir a mano. Al lado de cada uno se ve lo que dice el Semanal, y si no coinciden queda marcado.',
      },
      {
        kind: 'nuevo',
        area: 'Semanal',
        title: 'Cotización, categorías de gasto y datos de control',
        detail:
          'El período lleva todo a la moneda del campus con la cotización que carga un administrador (10 USD × 1500 = 15.000 ARS). Cada egreso lleva su categoría —las mismas nueve del Profit & Loss— y así baja al renglón que le toca. Transacciones dejó de ser un ingreso (no es dinero) y se le sumaron los sobres que trae el domingo: los dos juntos son la participación del reporte.',
        action:
          'Un período no se puede cerrar si falta una cotización o si quedan egresos sin categoría. Los dos avisos aparecen arriba en la pantalla del período, y la categoría se elige ahí mismo, en cada movimiento.',
      },
      {
        kind: 'nuevo',
        area: 'Semanal y Gastos',
        title: 'Los pagos en efectivo que quedaron afuera se traen al libro',
        detail:
          'Un pago en efectivo se registra aunque no haya período abierto: el recibo lleva número correlativo y ya está entregado. Lo que quedaba pendiente era el asiento. Ahora el período avisa cuántos pagos con fecha adentro no están en el libro, los lista con su número de recibo y los trae con un botón.',
        action:
          'Entran sin categoría, como cualquier gasto que baja de Gastos: elegísela antes de cerrar el período.',
      },
      {
        kind: 'nuevo',
        area: 'Semanal',
        title: 'Un período abierto por error se puede borrar',
        detail:
          'Igual que con los domingos: si un administrador abrió un período con las fechas equivocadas, lo borra desde la lista de Semanal. Se borra en todos los campus a la vez, junto con los Profit & Loss que nacieron con él.',
        action:
          'Solo aparece mientras nadie lo tocó: sin movimientos, sin ningún campus cerrado y con los reportes todavía en blanco. Si un domingo ya bajó sus números, reabrilo para retirarlos y el período vuelve a quedar vacío.',
      },
      {
        kind: 'nuevo',
        area: 'Actas',
        title: 'El cierre del período y el Profit & Loss quedan archivados',
        detail:
          'Al cerrar un período se genera su PDF, con el detalle de los movimientos y las cotizaciones que se usaron. Ese PDF y el del Profit & Loss ahora aparecen en Actas, junto a los conteos, las cajas y los cierres de domingo.',
      },
      {
        kind: 'nuevo',
        area: 'Domingos',
        title: 'Un domingo abierto por error se puede borrar',
        detail:
          'Si abriste un domingo con la fecha o el campus equivocados, ahora podés borrarlo desde la pantalla del domingo, junto al botón de cerrar. Solo aparece mientras el domingo esté abierto y no tenga nada cargado: sin actas, sin ventas y sin ingresos.',
        action:
          'Si el domingo ya tiene movimientos, la opción no aparece. Eso no se borra: el acta que esté mal se anula y se carga una nueva.',
      },
    ],
  },
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
