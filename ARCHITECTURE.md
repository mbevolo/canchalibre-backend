# Backend V2

## Responsabilidades

| Ubicación | Responsabilidad |
|---|---|
| `server.js` | Conectar MongoDB, iniciar HTTP y jobs, cerrar recursos con SIGTERM/SIGINT. |
| `app.js` | Construir Express sin abrir puertos ni conectar servicios externos. |
| `config/` | Configuración HTTP/CORS y conexión a la base. |
| `routes/` | Métodos, URLs y middleware. Los módulos auth/user/club/stats/superadmin existentes conservan sus handlers propios. |
| `controllers/` | Handlers extraídos del monolito por área funcional. |
| `services/` | Transacciones de reservas/pagos, disponibilidad, precios y mantenimiento. |
| `validations/` | Esquemas de reserva, cancha y búsqueda. |
| `middlewares/` | Autenticación, límites de solicitudes y respuestas de error. |
| `models/` | Modelos e índices de MongoDB. |
| `jobs/` | Programación de expiración de destacados y reservas, sin solapamiento. |

Importar `app.js` o `server.js` no abre conexiones ni programa tareas. Para ejecutar: `npm ci` y `npm start`. Para pruebas que requieren un servidor real: `await require('./server').startServer()`, que devuelve `{app, server, stop}`. Configurar variables antes de construir la aplicación; usar `stop()` para cerrar HTTP, jobs y MongoDB.

La base debe admitir transacciones. El servidor espera una conexión exitosa antes de escuchar. Las rutas retiradas mantienen su respuesta 410; no se recuperaron endpoints desde bloques legacy comentados. Errores de JSON, CORS y rutas inexistentes se responden como JSON, sin stack interno.

## Disponibilidad y consultas

El controlador valida los filtros y obtiene clubes activos, sus canchas y los turnos de la semana. El servicio genera los horarios sin acceder a MongoDB. La semana se calcula desde una fecha de Argentina y utiliza calendario UTC para evitar depender de la zona horaria del servidor. Conserva turnos de 60/90 minutos, cierre 24:00 y precio nocturno.

La selección de club filtra antes de generar horarios. Índices nuevos: `Cancha.clubEmail` y `Turno.{club,fecha}`. Revisar creación de índices y datos en una copia antes de cualquier despliegue a una base compartida. El benchmark local no constituye capacidad garantizada del hosting.

## Verificación

- `npm test`: unitarias, middleware y creación de app sin efectos externos.
- `npm run test:integration`: HTTP real + MongoDB replica set descartable; correo y SDK de pagos simulados.
- `npm run test:web`: Chromium + frontend vecino + backend/MongoDB aislados. Requiere instalar dependencias del frontend y Chromium mediante Playwright o `CHROMIUM_EXECUTABLE_PATH`.
- `npm run test:load`: datos sintéticos y concurrencia; nunca utiliza la base del usuario.
- `npm run audit:data`: consultas de solo lectura sobre una copia de desarrollo explícita; no repara registros.

No se desplegó V2. Credenciales externas, datos existentes, reintegros y móvil siguen postergados. La separación del monolito está realizada; futuras iteraciones pueden aplicar el patrón de controladores a los routers que ya eran independientes y consolidar plantillas de correo y checkout.
