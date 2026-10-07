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
- Cancelación de reserva impaga libera la reserva confirmada asociada. Las pagadas requieren gestión con el club.
- Webhook: pendiente no se consume definitivamente; aprobado valida moneda, importe, club y referencia antes de marcar pagado.
- SDK MP actual detrás de adaptador con cliente independiente por operación/club.
- Helmet, compresión HTTP y límite de solicitudes para crear reservas pendientes.
- Búsqueda de nombres escapa metacaracteres de regex y limita longitud.
- Precio nocturno incluye el campo nocturnoDesde al generar disponibilidad.
- Dependencias instaladas mediante npm ci; node_modules deja de estar versionado.

## Validación

- Backend: 8 pruebas unitarias y un recorrido HTTP de integración con MongoDB local descartable.
- Frontend: 12 pruebas con DOM simulado, verificación sintáctica de scripts externos e inline y recorrido adicional en Chromium.
- Integración: login, refresh concurrente, privacidad, invitado, reserva, confirmación concurrente, cancelación y webhook simulado pendiente/aprobado/importe incorrecto/duplicado.
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
- Consistencia entre Reserva y Turno ante caída del proceso: las actualizaciones de documentos distintos no forman una transacción; evaluar transacciones/reconciliación antes de producción.
- Rendimiento bajo carga representativa y políticas de pagos/reintegros con operaciones reales.
- App móvil postergada por indicación del usuario.

## Despliegue futuro

No copiar node_modules. Instalar con npm ci. Revisar versión de Node y las variables de entorno de desarrollo antes de arrancar. Nunca usar credenciales o bases de producción para las pruebas automatizadas.

La migración del SDK sigue los ejemplos del repositorio oficial https://github.com/mercadopago/sdk-nodejs.
