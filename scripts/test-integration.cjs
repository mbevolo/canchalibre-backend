// Base descartable: nunca utiliza MONGO_URI ni credenciales del usuario.
process.env.MONGOMS_VERSION ||= '7.0.14';
const { MongoMemoryServer } = require('mongodb-memory-server');
const { spawn } = require('node:child_process');
const path = require('node:path');
(async () => {
  const mongo = await MongoMemoryServer.create({
    instance: { dbName: 'canchalibre_test', args: ['--nounixsocket'] }
  });
  try {
    const child = spawn(process.execPath, ['--test', 'tests/reservation.integration.test.js'], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, MONGO_TEST_URI: mongo.getUri('canchalibre_test') },
      stdio: 'inherit'
    });
    process.exitCode = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', (code) => resolve(code ?? 1));
    });
  } finally {
    await mongo.stop();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
