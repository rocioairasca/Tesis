# Payments

Base: `/api/public/payments`

Modulo de pago simulado previo al registro de empresa. No procesa pagos reales.

**POST `/api/public/payments`**
- Descripcion: crear un pago simulado pendiente.
- Body: `plan` (`basic`, `professional`), `payment_method` (`qr`, `card`, `transfer`).
- Respuesta: pago con `transaction_number` unico.

**POST `/api/public/payments/:id/confirm`**
- Descripcion: aprobar el pago simulado.
- Nota: aca iria la consulta real a Mercado Pago en una integracion productiva.

**GET `/api/public/payments/:id`**
- Descripcion: consultar el estado de un pago simulado.

**POST `/api/public/register-company`**
- Requiere `paymentId` aprobado antes de crear empresa y administrador.
