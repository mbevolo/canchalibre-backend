require('dotenv').config();
const { createApp } = require('./app');
const { connectDatabase } = require('./config/database');
const { startJobs } = require('./jobs');
const mongoose = require('mongoose');

async function startServer({ port = process.env.PORT || 3000 } = {}) {
  await connectDatabase();
  await require('./fixtures/v2-test').seedV2Test();
  require('./utils/mercadopago').configure({
    access_token: process.env.MP_ACCESS_TOKEN,
  });
  const app = createApp();
  const server = app.listen(port);
  await new Promise((resolve, reject) => {
    if (server.listening) return resolve();
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const jobs = startJobs();
  let closing;
  return {
    app,
    server,
    stop() {
      if (!closing)
        closing = (async () => {
          jobs.stop();
          await new Promise((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          );
          await mongoose.disconnect();
        })();
      return closing;
    },
  };
}

if (require.main === module) {
  startServer()
    .then((runtime) => {
      console.log('Evento del servidor');
      for (const signal of ['SIGTERM', 'SIGINT'])
        process.once(signal, () => {
          runtime.stop().catch((error) => {
            console.error("No se pudo cerrar el servidor:");
            process.exitCode = 1;
          });
        });
    })
    .catch(async (error) => {
      console.error("No se pudo iniciar el servidor:");
      await mongoose.disconnect();
      process.exitCode = 1;
    });
}
module.exports = { startServer };
