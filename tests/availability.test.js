const { test } = require('node:test');
const assert = require('node:assert/strict');
const { weekBounds, generateAvailability } = require('../services/availability');
const { availabilityQuery } = require('../validations/availability');

test('weeks use Argentina date and reject impossible dates or structured filters', () => {
  assert.equal(weekBounds('', new Date('2030-01-07T01:00:00Z')).start, '2029-12-31');
  assert.equal(weekBounds('2030-01-10').end, '2030-01-13');
  assert.throws(() => weekBounds('2030-02-30'), /Fecha inválida/);
  assert.ok(availabilityQuery({ fecha: '2030-02-30' }).error);
  assert.ok(availabilityQuery({ club: ['a', 'b'] }).error);
  assert.ok(availabilityQuery({ provincia: { $ne: null } }).error);
});

test('90 minute slots, midnight closing and night prices retain owner-only contact details', () => {
  const data = {
    courts: [{ _id: 'court-a', nombre: 'Test', deporte: 'padel', clubEmail: 'club@example.com', diasDisponibles: ['Juéves'], horaDesde: '17:30', horaHasta: '24:00', duracionTurno: 90, precio: 1000, nocturnoDesde: 18, precioNocturno: 1500 }],
    clubs: [{ email: 'club@example.com', latitud: 0, longitud: 0 }],
    bookings: [{ _id: 'booking-a', canchaId: 'court-a', fecha: '2030-01-10', hora: '19:00', usuarioReservado: 'Cliente', emailReservado: 'private@example.com', pagado: true }],
    days: weekBounds('2030-01-10').days
  };
  const publicSlots = generateAvailability(data);
  assert.deepEqual(publicSlots.map(s => s.hora), ['17:30', '19:00', '20:30', '22:00']);
  assert.deepEqual(publicSlots.map(s => s.precio), [1000, 1500, 1500, 1500]);
  assert.equal(publicSlots[1].usuarioReservado, 'RESERVADO');
  assert.equal(publicSlots[1].emailReservado, null);
  assert.equal(publicSlots[0].latitud, 0);
  const privateSlots = generateAvailability({ ...data, ownerEmail: 'club@example.com' });
  assert.equal(privateSlots[1].usuarioReservado, 'Cliente');
  assert.equal(privateSlots[1].emailReservado, 'private@example.com');
  assert.deepEqual(generateAvailability({ ...data, clubs: [] }), []);
});

test('malformed legacy schedules do not loop or generate invalid slots', () => {
  const data = { courts: [{ _id: 'court', clubEmail: 'club@example.com', horaDesde: '08:00', horaHasta: '22:00', duracionTurno: -30, diasDisponibles: ['jueves'] }], clubs: [{ email: 'club@example.com' }], bookings: [], days: weekBounds('2030-01-10').days };
  assert.deepEqual(generateAvailability(data), []);
});
