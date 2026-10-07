const {test} = require('node:test');
const assert = require('node:assert/strict');
const {confirmationHtml} = require('../services/confirmationEmail');
test('confirmation receipt escapes names and distinguishes confirmation from payment', () => {
  const html=confirmationHtml({_id:'test-id',fecha:'2026-10-08',hora:'18:00',precio:12000,metodoPago:'online'}, {nombre:'<script>alert(1)</script>',deporte:'padel',duracionTurno:90}, {nombre:'Club & Prueba'});
  assert.match(html,/08\/10\/2026/);assert.match(html,/18:00/);assert.match(html,/90 minutos/);
  assert.match(html,/pendiente de pago/);assert.match(html,/Club &amp; Prueba/);
  assert.doesNotMatch(html,/<script>/);
});
