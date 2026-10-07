const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('runtime logs only accept constant messages, never request or provider data', () => {
  const root = path.resolve(__dirname, '..');
  const files = ['server.js', ...['controllers', 'routes', 'utils', 'middlewares', 'config', 'jobs'].flatMap(dir =>
    fs.readdirSync(path.join(root, dir)).filter(file => file.endsWith('.js')).map(file => `${dir}/${file}`))];
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const calls = source.match(/console\.(?:log|warn|error)\s*\(/g) || [];
    const safe = source.match(/console\.(?:log|warn|error)\s*\(\s*(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\s*\)/g) || [];
    assert.equal(calls.length, safe.length, `Dynamic log in ${file}`);
    assert.ok(!source.includes('[DEV] Link de verificación'), file);
  }
});

test('email provider responses and errors cannot leak credentials or message contents', async () => {
  const axios = require('axios');
  const original = axios.post;
  const log = console.log, error = console.error;
  const output = [];
  console.log = console.error = (...args) => output.push(args.join(' '));
  try {
    axios.post = async () => ({ data: { token: 'secret-provider-result' } });
    await require('../utils/email').sendMail('private@example.test', 'Private', '<a>private-otp</a>');
    const failure = new Error('secret-provider-error');
    failure.config = { headers: { 'api-key': 'secret-api-key' } };
    failure.response = { data: { email: 'private@example.test', token: 'secret-error-token' } };
    axios.post = async () => { throw failure; };
    await assert.rejects(require('../utils/email').sendMail('private@example.test', 'Private', 'private-otp'), e => e === failure);
    assert.equal(output.length, 1);
    assert.doesNotMatch(output.join('\n'), /secret-|private@|private-otp/);
  } finally { axios.post = original; console.log = log; console.error = error; }
});
