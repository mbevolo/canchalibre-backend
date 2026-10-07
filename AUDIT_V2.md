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

- Backend: 13 pruebas unitarias y un recorrido HTTP de integración con MongoDB local descartable.
- Frontend: 13 pruebas con DOM simulado, verificación sintáctica de scripts externos e inline y recorrido adicional en Chromium.
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

## Arquitectura del backend

server.js queda dedicado al arranque y cierre. app.js crea Express sin conectar MongoDB, abrir puertos ni programar tareas. config separa HTTP/CORS y conexión; routes define endpoints y middleware; controllers procesa solicitudes por área; services contiene lógica compartida de reservas y pagos; validations contiene esquemas; jobs registra expiraciones y destacados.

Se extrajeron los 42 handlers activos del monolito. Los bloques legacy comentados se retiraron sin volver a habilitar rutas. Las rutas retiradas que respondían 410 conservan esa respuesta. El arranque espera MongoDB antes de escuchar y el cierre detiene tareas, HTTP y conexión. npm start ejecuta server.js.

Validación de la separación: unitarias (incluye creación sin efectos externos y fallo de conexión sin listener), integración HTTP con MongoDB, Chromium usuario/club/SuperAdmin y carga sintética aprobados. La auditoría y reintegros reales continúan pendientes de los accesos/política acordados.

## Continuación de etapas 4, 5 y 6

- Disponibilidad valida filtros/fechas reales, excluye clubes inactivos, aplica club antes de leer/generar canchas y calcula semanas según fecha argentina con calendario UTC. Servicio puro con pruebas de horarios, privacidad, 90 min, nocturno y cierre 24:00. Datos legacy malformados no generan bucles.
- Índices de apoyo por club en canchas y club/fecha en turnos. Revisión de índices sobre una copia sigue pendiente antes de despliegue.
- Benchmark actualizado: búsqueda de todos los clubes p95 146 ms; club seleccionado p95 32 ms (100 solicitudes por caso, concurrencia 10, fixture 10 clubes/100 canchas/1.000 turnos). Es una comparación entre alcances distintos en entorno local, no una mejora garantizada del hosting. Conserva una reserva entre 20 intentos concurrentes.
- Expiración de destacados actualiza lotes mediante una condición atómica, evitando el ciclo leer/guardar que podía borrar renovaciones recientes; tareas sin solapamiento.
- Buscador informa carga, cantidad, búsqueda vacía y error; permite reintentar, bloquea solicitudes duplicadas y anuncia estado mediante aria-live/aria-busy. Botones de reserva usan eventos en lugar de JavaScript interpolado en HTML. Capturas de escritorio y ancho 390 px revisadas; sin desbordamiento horizontal.
- API responde JSON para rutas inexistentes, JSON malformado y origen no autorizado; no muestra stack interno.

Estado del plan: etapa 2 (separación del monolito) realizada; etapas 4/5 ampliadas con cambios concretos, no una auditoría de infraestructura ni un rediseño integral. Etapa 6 ampliada a 13 unitarias backend, 13 frontend, integración, dos recorridos Chromium y benchmark. Etapas externas, datos existentes y reintegros mantienen sus pendientes. Ver ARCHITECTURE.md para responsabilidades y comandos.

## Cierre de logs y firma de webhooks

- Los logs de ejecución contienen únicamente mensajes constantes: se retiraron enlaces de verificación, contactos, enlaces de checkout y objetos completos de errores/respuestas. Dos pruebas impiden reintroducir datos dinámicos y verifican errores de email con credenciales simuladas.
- Ambos webhooks verifican HMAC-SHA256 y comparan la firma en tiempo constante antes de consultar pagos o acceder a eventos. El ID firmado de `data.id` es el que se consulta; IDs diferentes en cuerpo/query, firmas ausentes, inválidas o ambiguas se rechazan.
- Configurar `MP_WEBHOOK_SECRET` con el secreto de la aplicación MP que genera las notificaciones. No es el access token. Para aplicaciones independientes de clubes, `MP_CLUB_WEBHOOK_SECRETS` admite un objeto JSON de email del club a secreto, mantenido exclusivamente en variables del servidor. Para destacados puede configurarse `MP_FEATURED_WEBHOOK_SECRET`; si no se define usa el secreto común. El secreto común solo corresponde a notificaciones de esa misma aplicación.
- Sin secreto o con configuración inválida devuelve 503; no existe bypass por entorno. Sin firma válida devuelve 401. Los reintentos tardíos siguen sujetos a firma y a idempotencia, sin imponer una ventana temporal que descarte reenvíos legítimos.
- Contrato legacy IPN sin firma no aceptado. Antes de desplegar, configurar Webhooks en cada aplicación correspondiente y validar recepción real en sandbox. Referencia oficial: https://www.mercadopago.com.ar/developers/en/docs/wallet-connect/notifications (plantilla de firma).
- Pruebas locales de firma y recorrido de pagos aprobados, pendientes, duplicados y rollback usan secretos/pagos simulados. No sustituyen una prueba de Mercado Pago real. La credencial MongoDB expuesta sigue pendiente de revocación confirmada en Atlas.

## Revisión adicional de buscador y paneles

- Login de usuario y club rechaza email/password estructurados, vacíos o excesivamente largos antes de consultar credenciales.
- Directorio público valida tipos y longitud de provincia/localidad/búsqueda; usa lecturas lean con proyección explícita. Consulta por ID excluye clubes suspendidos.
- Frontend: mapa sin código interpolado en onclick, horarios agrupados por ubicación, contenido construido al abrir marcador y mapa anterior liberado. Enlaces de destaque con HTTPS y DOM seguro; agenda/listado bloquean solicitudes de pago repetidas.
- Panel del club: resumen de reservas de hoy escapa nombre/teléfono y toma el día de Argentina, no UTC. Edición/eliminación de canchas usa eventos DOM.
- SuperAdmin: cambios rápidos de sección descartan respuestas tardías, incluidos errores de solicitudes anteriores.
- MongoDB: usuario `turnolibre_user` compartido con producción confirmado por el titular. Rotación en Atlas y actualización coordinada de Render postergadas explícitamente; la credencial expuesta sigue vigente. No se modificaron esos servicios.
- No se completó un rediseño integral ni se validaron proveedores/infraestructura real: continúan pendientes sandbox de MP, Brevo y auditoría de datos de desarrollo con acceso autorizado.
