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
- Estadísticas filtradas por mes solicitado y capacidad calculada según calendario real.
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
- Integración: login, refresh concurrente, suspensión, privacidad pública y administrativa, roles, invitado, reserva, confirmación concurrente, cancelación, estadísticas históricas y webhook simulado pendiente/aprobado/importe incorrecto/duplicado.
- Fallas de escritura inyectadas verifican rollback de confirmación, cancelación y pago, seguido de reintento exitoso. Prueba de pago tardío tras reutilizar un horario.
- Destacados: pendiente/aprobado, importe incorrecto, duplicado y cambio de configuración después de generar checkout; se conserva precio y duración originales.
- SDK: prueba de solicitudes reales del SDK con transporte HTTP simulado; verifica aislamiento de tokens de dos clubes.
- npm audit --omit=dev: 0 alertas conocidas en dependencias de ejecución del backend.
- npm audit: 0 alertas conocidas en frontend.

Estos resultados no garantizan ausencia de defectos o vulnerabilidades.

## Pendientes para cerrar la validación de V2

- Chromium: buscador, detalle, reserva con JWT y logout pasaron con API y recursos externos simulados; capturas revisadas y contraste del encabezado de detalle corregido. También pasó navegador + backend + MongoDB aislados: cookie HttpOnly, refresh entre páginas, perfil, reserva, OTP y logout. Pendiente Leaflet y recursos CSS externos.
- MercadoPago sandbox con credenciales de prueba: checkout completo y recepción de webhook del proveedor.
- Brevo con destinatario de prueba: entrega de verificación, OTP y recuperación de contraseña.
- Paneles completos de club y SuperAdmin: recorridos funcionales de agenda, ABM y estadísticas.
- Datos existentes: revisar índices y consistencia antes de aplicar cambios a una base compartida.
- Migración de pagos antiguos: reservas sin bookingId mantienen referencia antigua; enlaces anteriores de destacados sin orden deben reconciliarse antes de desplegar esta versión.
- Rendimiento bajo carga representativa y políticas de pagos/reintegros con operaciones reales.
- App móvil postergada por indicación del usuario.

## Despliegue futuro

MongoDB debe admitir transacciones (replica set o clúster fragmentado); las pruebas arrancan un replica set descartable. No copiar node_modules. Instalar con npm ci. Revisar versión de Node y las variables de entorno de desarrollo antes de arrancar. Nunca usar credenciales o bases de producción para las pruebas automatizadas.

La migración del SDK sigue los ejemplos del repositorio oficial https://github.com/mercadopago/sdk-nodejs.
