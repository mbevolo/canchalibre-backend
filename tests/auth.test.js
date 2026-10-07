const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const optionalAuthUser = require('../middlewares/optionalAuthUser');
const Usuario = require('../models/Usuario');
Usuario.findById = () => ({ select: () => ({ lean: async () => ({ activo: true, emailVerificado: true }) }) });
process.env.JWT_ACCESS_SECRET = 'isolated-test-secret';
async function invoke(header) {
  const req = { headers: header ? { authorization: header } : {} };
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  let continued = false;
  await optionalAuthUser(req, res, () => { continued = true; });
  return { req, res, continued };
}
function token(payload, expiresIn = '15m') {
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET, { issuer: 'canchalibre-api', audience: 'canchalibre-web', expiresIn });
}
test('guest request continues without an identity', async () => {
  const r = await invoke(); assert.equal(r.continued, true); assert.equal(r.req.userId, undefined);
});
test('valid user token establishes server identity', async () => {
  const r = await invoke('Bearer ' + token({ sub: 'user-123', role: 'user', type: 'access' }));
  assert.equal(r.continued, true); assert.equal(r.req.userId, 'user-123');
});
test('expired token returns 401 so frontend can refresh', async () => {
  const r = await invoke('Bearer ' + token({ sub: 'user-123', role: 'user', type: 'access' }, -1));
  assert.equal(r.continued, false); assert.equal(r.res.code, 401);
});
test('club token and malformed credentials never become guest requests', async () => {
  for (const header of ['Bearer ' + token({ sub: 'club-123', role: 'club', type: 'access' }), 'Bearer invalid', 'Basic invalid']) {
    const r = await invoke(header); assert.equal(r.continued, false); assert.equal(r.res.code, 401);
  }
});
