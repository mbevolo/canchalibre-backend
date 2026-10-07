# Pruebas V2

Requisito: Node.js 20.19 o superior, o Node.js 22.12 o superior.

- `npm ci`: instala las dependencias, incluidas las de desarrollo.
- `npm test`: ejecuta las pruebas de autenticación; omite la integración si no se proporciona una base local de prueba.
- `npm run test:integration`: inicia MongoDB temporal, ejecuta el recorrido HTTP y elimina la base al terminar. La primera ejecución descarga MongoDB y requiere acceso a Internet.

La integración no utiliza `MONGO_URI` de tu configuración. Acepta únicamente una base `canchalibre_test` en `127.0.0.1`, simula el envío de correos y utiliza reservas en efectivo sin llamar a MercadoPago. No inicia las tareas programadas del servidor.

Cubre login, cookie HttpOnly, renovación y revocación del refresh anterior, identidad de reserva tomada del JWT, listado de pendientes, confirmación por OTP, aislamiento entre usuarios, cancelación y cierre de sesión.

La integración también verifica privacidad pública, refresh concurrente, reserva concurrente del club, confirmación concurrente, rechazo de usuarioId de invitado y pagos simulados (pendiente, aprobado, importe incorrecto y duplicado). No usa las credenciales ni llama a MercadoPago: el SDK tiene además una prueba separada con transporte HTTP simulado.

Para navegador + backend reales: instalar las dependencias de ambos repositorios (`npm ci` en cada uno), instalar Chromium desde el frontend (`npx playwright install chromium`) y ejecutar `npm run test:web` en el backend. Por defecto busca el frontend en la carpeta hermana `canchalibre-frontend`; `FRONTEND_TEST_DIR` permite otra ruta. Admite `CHROMIUM_EXECUTABLE_PATH` y `CHROMIUM_ARGS`. Usa MongoDB descartable, datos sintéticos y correo simulado. Comprueba cookies HttpOnly, refresh entre páginas, perfil, reserva, OTP y logout, sin llamar a producción.
