# Estado de V2 — 7 de octubre de 2026 (UTC)

Trabajo exclusivamente sobre v2-development. Sin cambios en main ni despliegues.

## Implementado y comprobado

- JWT de usuario en login, perfil, buscador y reservas; refresh cookie HttpOnly.
- Rotación atómica del refresh: un token no puede renovarse dos veces en paralelo.
- Tokens malformados no degradan una solicitud autenticada al flujo de invitados.
- Sin hashes de contraseña, tokens de recuperación ni credenciales MP en respuestas públicas.
- Disponibilidad pública sin emails de clientes; panel privado autenticado conserva sus datos.
- Protección de cambios de ubicación y reserva directa por autenticación del club propietario.
- Validación de días, horas, duración, fechas reales y turnos futuros en hora argentina.
- Invitados no pueden asignarse un usuarioId mediante el cuerpo de la solicitud.
- Ocupación atómica del turno e índices únicos para solicitudes simultáneas.
- Confirmación y cancelación de reservas con transacciones entre Reserva y Turno; las pagadas requieren gestión de reintegro con el club.
- Suspensión de usuario invalida inmediatamente el acceso a rutas protegidas.
- Respuestas administrativas sin hashes, tokens de recuperación ni credenciales MP.
- Estadísticas filtradas por mes solicitado y capacidad calculada según calendario real; inicialización única de gráficos.
- ABM de canchas con validación de tipos, minutos, días, precios y duración; permisos del club propietario.
- Edición de email del club migra sus canchas y turnos en una transacción.
- Paneles de club y SuperAdmin escapan texto de registros antes de insertarlo en HTML.
- Club: edición conserva días seleccionados, logout elimina JWT y links de pago y consulta de turno usan rutas protegidas vigentes.
- Reserva manual desde agenda conserva teléfono y muestra nombre de clientes sin cuenta. Enlace de pago en diálogo local, disponible con y sin teléfono, sin depender de ventanas emergentes.
- Marcar pago manual solo opera sobre reservas activas, registra medio y fecha y no sobrescribe pagos previos. Cancelación pagada conserva reserva y muestra error claro en el panel.
- Webhook: pendiente no se consume definitivamente; aprobado valida moneda, importe, club y referencia única de la reserva antes de marcar pagado. Pago y evento se guardan en una transacción.
- Reutilizar un horario genera otra referencia; una aprobación tardía de la reserva anterior se rechaza.
- Destacados: checkout autorizado por club, orden con precio y días fijados al comprar; aprobación transaccional, renovaciones acumuladas e idempotencia.
- SDK MP actual detrás de adaptador con cliente independiente por operación/club.
- Helmet, compresión HTTP y límite de solicitudes para crear reservas pendientes.
- Búsqueda de nombres escapa metacaracteres de regex y limita longitud.
- Precio nocturno incluye el campo nocturnoDesde al generar disponibilidad.
- Dependencias instaladas mediante npm ci; node_modules deja de estar versionado.

## Validación

- Backend: 8 pruebas unitarias y un recorrido HTTP de integración con MongoDB local descartable.
- Frontend: 12 pruebas con DOM simulado, verificación sintáctica de scripts externos e inline y recorrido adicional en Chromium.
- Texto con marcado HTML probado en ambos paneles: se muestra como texto sin ejecutar contenido.
- Integración: login, refresh concurrente, suspensión, privacidad pública y administrativa, roles, invitado, reserva, confirmación concurrente, cancelación, estadísticas históricas y webhook simulado pendiente/aprobado/importe incorrecto/duplicado.
- Fallas de escritura inyectadas verifican rollback de confirmación, cancelación y pago, seguido de reintento exitoso. Prueba de pago tardío tras reutilizar un horario.
- Destacados: pendiente/aprobado, importe incorrecto, duplicado y cambio de configuración después de generar checkout; se conserva precio y duración originales.
- SDK: prueba de solicitudes reales del SDK con transporte HTTP simulado; verifica aislamiento de tokens de dos clubes.
- npm audit --omit=dev: 0 alertas conocidas en dependencias de ejecución del backend.
- npm audit: 0 alertas conocidas en frontend.

Estos resultados no garantizan ausencia de defectos o vulnerabilidades.

## Pendientes para cerrar la validación de V2

- Chromium: buscador y detalle con capturas revisadas. Navegador + backend + MongoDB aislados: cookie HttpOnly, refresh, perfil, reserva, OTP, logout; SuperAdmin login, secciones, edición de club, configuración y logout; club login, ABM de canchas, reserva manual desde agenda, nombre/teléfono, pago simulado y enlace WhatsApp sin enviarlo, enlace sin teléfono, cancelación impaga, rechazo de cancelación pagada, QR, estadísticas y logout. Bootstrap, Leaflet, FullCalendar, QRCode y Chart.js se sirven desde dependencias locales de prueba. Mapas/tiles y otros recursos de terceros siguen simulados.
- MercadoPago sandbox con credenciales de prueba: checkout completo y recepción de webhook del proveedor.
- Brevo con destinatario de prueba: entrega de verificación, OTP y recuperación de contraseña.
- Reintegros y comportamiento con servicios externos reales. WhatsApp solo se preparó como enlace; no se enviaron mensajes.
- Datos existentes: revisar índices y consistencia antes de aplicar cambios a una base compartida.
- Migración de pagos antiguos: reservas sin bookingId mantienen referencia antigua; enlaces anteriores de destacados sin orden deben reconciliarse antes de desplegar esta versión.
- Carga sobre infraestructura de desarrollo comparable al hosting real y validación de políticas de pagos/reintegros con credenciales de prueba.
- App móvil postergada por indicación del usuario.

## Despliegue futuro

MongoDB debe admitir transacciones (replica set o clúster fragmentado); las pruebas arrancan un replica set descartable. No copiar node_modules. Instalar con npm ci. Revisar versión de Node y las variables de entorno de desarrollo antes de arrancar. Nunca usar credenciales o bases de producción para las pruebas automatizadas.

La migración del SDK sigue los ejemplos del repositorio oficial https://github.com/mercadopago/sdk-nodejs.

## Carga sintética y revisión de datos

`npm run test:load` arranca API y MongoDB descartables; genera 10 clubes, 100 canchas y 1.000 turnos. Ejecuta 100 consultas por endpoint con concurrencia 10 y 20 reservas simultáneas del mismo horario. Resultado local: clubes p50 18 ms / p95 37 ms; disponibilidad p50 117 ms / p95 148 ms; una reserva y 19 conflictos, sin duplicados. Estas mediciones son una referencia local, no capacidad ni SLA de producción.

`npm run audit:data` requiere MONGO_AUDIT_URI y MONGO_AUDIT_DB con nombre explícito de desarrollo/test. Usar copia de desarrollo y credenciales de solo lectura. Informa cantidades de duplicados, documentos sin cancha/club, reservas confirmadas sin turno ocupado, pagos sin ocupación, reservas antiguas sin bookingId y pendientes vencidos; verifica el índice único. No crea índices ni repara registros. No incluye emails, nombres ni claves en el informe. Ejecutar sobre una copia sin escrituras concurrentes para un resultado consistente. Su detección y ausencia de modificaciones se comprobaron con datos aislados.

## Propuesta de cancelación y reintegro (sin implementar)

- Reserva impaga: cancelar según el plazo que se defina y liberar horario.
- Reserva pagada: cliente solicita, club acepta o rechaza conforme a la política comunicada al reservar. SuperAdmin interviene en disputas, con registro de responsable y motivo.
- MercadoPago: consultar pago original y pedir reintegro con credenciales del club receptor; guardar identificador y monto. Evitar duplicación de solicitudes. Si no hay confirmación o la respuesta es ambigua, mantener reintegro pendiente y reconciliar con el proveedor.
- Efectivo u otro medio manual: el club devuelve por el medio acordado y registra importe, fecha y comprobante; la plataforma no mueve ese dinero.
- Liberar horario al confirmar el reintegro en este circuito propuesto. No cambiar pagado a false para simular una devolución.
- Falta acordar plazo, reintegro total/parcial, excepciones por cancelación del club y quién puede autorizar cada caso. No se fijó automáticamente una penalidad ni se efectuaron reintegros.

Documentación del proveedor: https://www.mercadopago.com.ar/developers/es/docs/sales-processing/cancellations-and-refunds
