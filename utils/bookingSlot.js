const days = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function validBookingSlot(cancha, fecha, hora, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(hora)) return false;
  const day = new Date(fecha + 'T12:00:00Z');
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== fecha) return false;
  if (new Date(fecha + 'T' + hora + ':00-03:00') <= now) return false;
  if (!cancha.diasDisponibles?.map(normalize).includes(days[day.getUTCDay()])) return false;
  const minutes = value => {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value))) return NaN;
    const [h, m] = value.split(':').map(Number); return h * 60 + m;
  };
  const start = minutes(cancha.horaDesde), end = cancha.horaHasta === '24:00' ? 1440 : minutes(cancha.horaHasta), slot = minutes(hora);
  const duration = Number(cancha.duracionTurno || 60);
  return Number.isFinite(start) && Number.isFinite(end) && duration > 0 && slot >= start && slot + duration <= end && (slot - start) % duration === 0;
}
module.exports = { validBookingSlot };
