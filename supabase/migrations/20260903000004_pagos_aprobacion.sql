-- =============================================================
-- Denario v2 — Pagos y transferencias: aprobar y pagar son dos pasos
--
-- Venia de "Presupuestos", donde aprobar y pagar eran uno solo. Para un pago
-- o una transferencia no alcanza: se aprueba primero, y despues alguien va y
-- lo paga — capaz otro dia, capaz otra persona. Sin ese corte no hay forma de
-- decir "esto esta autorizado pero todavia no salio".
--
-- Queda igual que Compras:
--   pendiente -> aprobado -> pagado   (o rechazado)
--
-- El estado nuevo va despues de 'pending' para que el orden del enum siga al
-- del flujo; nada ordena por esta columna hoy, pero si alguna vez lo hace va
-- a salir bien solo.
-- =============================================================

alter type payment_status add value if not exists 'approved' after 'pending';
