const express = require('express');
const Turno = require('../models/Turno');
const Cancha = require('../models/Cancha');
const authClub = require('../middlewares/authClub');
const router = express.Router();
const weekdays = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function minutes(value) {
  if (value === '24:00') return 1440;
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value))) return NaN;
  const [hour, minute] = value.split(':').map(Number); return hour * 60 + minute;
}
router.get('/overview', authClub, async (req, res) => {
  try {
    const now = new Date();
    const anio = req.query.anio === undefined ? now.getFullYear() : Number(req.query.anio);
    const mes = req.query.mes === undefined ? now.getMonth() + 1 : Number(req.query.mes);
    if (!Number.isInteger(anio) || anio < 2000 || anio > 2100 || !Number.isInteger(mes) || mes < 1 || mes > 12) {
      return res.status(400).json({ error: 'Año o mes inválido' });
    }
    const prefix = `${anio}-${String(mes).padStart(2, '0')}`;
    const days = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
    const [turnos, canchas] = await Promise.all([
      Turno.find({ club: req.clubEmail, fecha: { $gte: prefix + '-01', $lte: prefix + '-' + days } })
        .select('fecha hora deporte canchaId precio pagado usuarioReservado').lean(),
      Cancha.find({ clubEmail: req.clubEmail }).select('nombre diasDisponibles horaDesde horaHasta duracionTurno').lean()
    ]);
    const booked = turnos.filter(t => t.usuarioReservado);
    const paid = booked.filter(t => t.pagado);
    const reservasPorDia = [];
    const ingresosPorDeporte = {};
    const hourCounts = new Map();
    const courtCounts = new Map();
    const dayCounts = new Map();
    for (const t of booked) {
      dayCounts.set(t.fecha, (dayCounts.get(t.fecha) || 0) + 1);
      const hour = String(t.hora || '').slice(0, 2) + ':00';
      hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
      courtCounts.set(String(t.canchaId), (courtCounts.get(String(t.canchaId)) || 0) + 1);
    }
    for (const t of paid) ingresosPorDeporte[t.deporte || 'Otro'] = (ingresosPorDeporte[t.deporte || 'Otro'] || 0) + Number(t.precio || 0);
    let capacity = 0;
    for (let day = 1; day <= days; day++) {
      const date = prefix + '-' + String(day).padStart(2, '0');
      reservasPorDia.push({ dia: date, cantidad: dayCounts.get(date) || 0 });
      const weekday = weekdays[new Date(Date.UTC(anio, mes - 1, day)).getUTCDay()];
      for (const court of canchas) {
        if (!court.diasDisponibles?.map(normalize).includes(weekday)) continue;
        const start = minutes(court.horaDesde), end = minutes(court.horaHasta);
        const duration = Number(court.duracionTurno || 60);
        if (Number.isFinite(start) && Number.isFinite(end) && duration > 0 && end > start) capacity += Math.floor((end - start) / duration);
      }
    }
    return res.json({
      totalReservas: booked.length,
      ingresosMP: paid.reduce((sum, t) => sum + Number(t.precio || 0), 0),
      ocupacionPromedio: capacity ? booked.length / capacity * 100 : 0,
      reservasPorDia,
      ingresosPorDeporte,
      horasPico: Array.from({ length: 24 }, (_, h) => { const hora = String(h).padStart(2, '0') + ':00'; return { hora, cantidad: hourCounts.get(hora) || 0 }; }),
      ocupacionPorCancha: canchas.filter(c => courtCounts.has(String(c._id))).map(c => ({ nombre: c.nombre, cantidad: courtCounts.get(String(c._id)) }))
    });
  } catch (error) {
    console.error("Error overview:");
    return res.status(500).json({ error: 'Error generando estadísticas' });
  }
});
module.exports = router;
