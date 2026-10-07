const cron = require('node-cron');
const { expireFeatured, expirePending } = require('../services/maintenance');
function startJobs() {
  const schedule = (expression, operation, label) =>
    cron.schedule(
      expression,
      async () => {
        try {
          const result = await operation();
          if (result.modifiedCount)
            console.log('Evento del servidor');
        } catch (error) {
          console.error('Evento del servidor');
        }
      },
      { noOverlap: true },
    );
  const tasks = [
    schedule('*/5 * * * *', expireFeatured, 'Expiración de destacados'),
    schedule('*/2 * * * *', expirePending, 'Expiración de reservas'),
  ];
  return {
    stop() {
      tasks.forEach((task) => task.stop());
    },
  };
}
module.exports = { startJobs };
