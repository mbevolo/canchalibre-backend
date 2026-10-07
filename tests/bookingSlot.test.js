const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validBookingSlot } = require('../utils/bookingSlot');
const cancha = { diasDisponibles: ['jueves'], horaDesde: '08:00', horaHasta: '22:00', duracionTurno: 60 };
const now = new Date('2026-10-07T00:00:00Z');
test('only real future dates on configured days and slot boundaries are accepted', () => {
  assert.equal(validBookingSlot(cancha, '2030-01-10', '10:00', now), true);
  for (const [fecha, hora] of [['2030-02-30', '10:00'], ['2030-01-11', '10:00'], ['2030-01-10', '10:30'], ['2030-01-10', '22:00'], ['2020-01-02', '10:00']]) {
    assert.equal(validBookingSlot(cancha, fecha, hora, now), false);
  }
});
test('future check uses Argentina time rather than server timezone', () => {
  assert.equal(validBookingSlot(cancha, '2030-01-10', '10:00', new Date('2030-01-10T12:59:00Z')), true);
  assert.equal(validBookingSlot(cancha, '2030-01-10', '10:00', new Date('2030-01-10T13:01:00Z')), false);
});

test('supports closing at midnight and slots of 90 minutes', () => {
  assert.equal(validBookingSlot({ ...cancha, horaHasta: '24:00' }, '2030-01-10', '23:00', now), true);
  const long = { ...cancha, duracionTurno: 90 };
  assert.equal(validBookingSlot(long, '2030-01-10', '09:30', now), true);
  assert.equal(validBookingSlot(long, '2030-01-10', '10:00', now), false);
});
