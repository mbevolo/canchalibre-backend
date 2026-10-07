const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isTestDeployment, seedV2Test } = require('../fixtures/v2-test');
const env = {
  APP_BASE_URL: 'https://canchalibre-backend-v2-test.onrender.com',
  FRONT_URL: 'https://canchalibre-frontend-v2-test.vercel.app',
};
test('fixtures require both exact test hosts and the isolated database', async () => {
  assert.equal(isTestDeployment(env, 'canchalibre_v2_test'), true);
  for (const database of ['turnolibre', 'production', undefined]) {
    assert.equal(isTestDeployment(env, database), false);
    assert.equal(await seedV2Test({env, connection: {name: database}}), false);
  }
  assert.equal(isTestDeployment({...env, APP_BASE_URL: 'https://api.canchalibre.ar'}, 'canchalibre_v2_test'), false);
  assert.equal(isTestDeployment({...env, FRONT_URL: 'https://www.canchalibre.ar'}, 'canchalibre_v2_test'), false);
});
