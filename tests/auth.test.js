const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const optionalAuthUser = require('../middlewares/optionalAuthUser');
process.env.JWT_ACCESS_SECRET = 'isolated-test-secret';
function invoke(header) {
  const req = { headers: header ? { authorization: header } : {} };
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  let continued = false;
  optionalAuthUser(req, res, () => { continued = true; });
  return { req, res, continued };
}
function token(payload, expiresIn = '15m') {
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET, { issuer: 'canchalibre-api', audience: 'canchalibre-web', expiresIn });
}
test('guest request continues without an identity', () => {
  const r = invoke(); assert.equal(r.continued, true); assert.equal(r.req.userId, undefined);
});
test('valid user token establishes server identity', () => {
  const r = invoke('Bearer ' + token({ sub: 'user-123', role: 'user', type: 'access' }));
  assert.equal(r.continued, true); assert.equal(r.req.userId, 'user-123');
});
test('expired token returns 401 so frontend can refresh', () => {
  const r = invoke('Bearer ' + token({ sub: 'user-123', role: 'user', type: 'access' }, -1));
  assert.equal(r.continued, false); assert.equal(r.res.code, 401);
});
test('club token and malformed credentials never become guest requests', () => {
  for (const header of ['Bearer ' + token({ sub: 'club-123', role: 'club', type: 'access' }), 'Bearer invalid', 'Basic invalid']) {
    const r = invoke(header); assert.equal(r.continued, false); assert.equal(r.res.code, 401);
  }
});
