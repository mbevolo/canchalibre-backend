const Club = require('../models/Club');
const Cancha = require('../models/Cancha');
const Turno = require('../models/Turno');
const { availabilityQuery } = require('../validations/availability');
const { generateAvailability } = require('../services/availability');

async function getTurnosGenerados(req, res) {
  const input = availabilityQuery(req.query);
  if (input.error) return res.status(400).json({ error: input.error });
  try {
    const filter = { activo: { $ne: false } };
    for (const field of ['provincia', 'localidad'])
      if (input.value[field]) filter[field] = input.value[field];
    if (input.value.club) filter.email = input.value.club;
    const clubs = await Club.find(filter)
      .select('email nombre latitud longitud')
      .lean();
    if (!clubs.length) return res.json([]);
    const courts = await Cancha.find({
      clubEmail: { $in: clubs.map((c) => c.email) },
    })
      .select(
        '_id nombre deporte clubEmail diasDisponibles horaDesde horaHasta duracionTurno precio precioNocturno nocturnoDesde',
      )
      .lean();
    if (!courts.length) return res.json([]);
    const bookings = await Turno.find({
      fecha: { $gte: input.week.start, $lte: input.week.end },
      canchaId: { $in: courts.map((c) => String(c._id)) },
    })
      .select('canchaId fecha hora usuarioReservado emailReservado pagado')
      .lean();
    return res.json(
      generateAvailability({
        courts,
        clubs,
        bookings,
        days: input.week.days,
        ownerEmail: req.clubEmail,
      }),
    );
  } catch (error) {
    console.error('Error generando disponibilidad:', error);
    return res.status(500).json({ error: 'Error al generar turnos' });
  }
}
module.exports = { getTurnosGenerados };
