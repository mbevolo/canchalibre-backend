const weekdays = [
  'domingo',
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'sabado',
];
const normalize = (value) =>
  String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
const { precioPorHora } = require('./booking');

function weekBounds(fecha, now = new Date()) {
  const date =
    fecha ||
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Fecha inválida');
  const monday = new Date(date + 'T00:00:00Z');
  if (
    !Number.isFinite(monday.getTime()) ||
    monday.toISOString().slice(0, 10) !== date
  )
    throw new Error('Fecha inválida');
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const days = Array.from(
    { length: 7 },
    (_, n) => new Date(monday.getTime() + n * 86400000),
  );
  return {
    start: days[0].toISOString().slice(0, 10),
    end: days[6].toISOString().slice(0, 10),
    days,
  };
}

function generateAvailability({ courts, clubs, bookings, days, ownerEmail }) {
  const clubByEmail = new Map(clubs.map((club) => [club.email, club]));
  const occupied = new Map(
    bookings.map((slot) => [
      `${slot.canchaId}|${slot.fecha}|${slot.hora}`,
      slot,
    ]),
  );
  const minutes = (value) => {
    if (value === '24:00') return 1440;
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value))) return NaN;
    const [h, m] = value.split(':').map(Number);
    return h * 60 + m;
  };
  const result = [];
  for (const court of courts) {
    const club = clubByEmail.get(court.clubEmail);
    if (!club) continue;
    const start = minutes(court.horaDesde),
      end = minutes(court.horaHasta),
      duration = Number(court.duracionTurno || 60);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      !Number.isInteger(duration) ||
      duration < 1 ||
      duration > 1440
    )
      continue;
    const availableDays = new Set((court.diasDisponibles || []).map(normalize));
    for (const day of days) {
      if (!availableDays.has(weekdays[day.getUTCDay()])) continue;
      const fecha = day.toISOString().slice(0, 10);
      for (let minute = start; minute + duration <= end; minute += duration) {
        const hour = Math.floor(minute / 60),
          hora =
            String(hour).padStart(2, '0') +
            ':' +
            String(minute % 60).padStart(2, '0');
        const slot = occupied.get(`${court._id}|${fecha}|${hora}`),
          privateSlot = ownerEmail === court.clubEmail;
        result.push({
          canchaId: court._id,
          nombreCancha: court.nombre,
          deporte: court.deporte,
          club: court.clubEmail,
          fecha,
          hora,
          precio: precioPorHora(court, hour),
          ocupado: Boolean(slot?.usuarioReservado),
          usuarioReservado: slot?.usuarioReservado
            ? privateSlot
              ? slot.usuarioReservado
              : 'RESERVADO'
            : null,
          emailReservado: privateSlot && slot ? slot.emailReservado : null,
          pagado: slot ? slot.pagado : false,
          realId: slot ? slot._id : null,
          latitud: club.latitud ?? null,
          longitud: club.longitud ?? null,
          duracionTurno: duration,
        });
      }
    }
  }
  return result;
}
module.exports = { weekBounds, generateAvailability };
