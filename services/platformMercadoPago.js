const crypto = require('node:crypto');
const Config = require('../models/config');
function key() {
  const secret = process.env.PLATFORM_CREDENTIAL_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('Credenciales sin clave de cifrado');
  return crypto.hkdfSync('sha256', secret, 'canchalibre-platform-v1', 'mercadopago-secrets', 32);
}
function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}
function decrypt(value) {
  const [version, iv, tag, data] = value.split('.');
  if (version !== 'v1') throw new Error('Credencial inválida');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
async function credentials() {
  const config = await Config.findOne().select('+mpTokenEncrypted +mpWebhookEncrypted');
  return {
    accessToken: config?.mpTokenEncrypted ? decrypt(config.mpTokenEncrypted) : process.env.MP_ACCESS_TOKEN,
    webhookSecret: config?.mpWebhookEncrypted ? decrypt(config.mpWebhookEncrypted) : process.env.MP_FEATURED_WEBHOOK_SECRET || process.env.MP_WEBHOOK_SECRET,
  };
}
function status(config) {
  return {
    configured: Boolean(config?.mpTokenEncrypted || process.env.MP_ACCESS_TOKEN),
    source: config?.mpTokenEncrypted ? 'panel' : process.env.MP_ACCESS_TOKEN ? 'servidor' : null,
    account: config?.mpAccount?.id ? config.mpAccount : null,
    verifiedAt: config?.mpVerifiedAt || null,
    webhookConfigured: Boolean(config?.mpWebhookEncrypted || process.env.MP_FEATURED_WEBHOOK_SECRET || process.env.MP_WEBHOOK_SECRET),
    webhookUrl: (process.env.APP_BASE_URL || 'https://api.canchalibre.ar').replace(/\/$/, '') + '/api/mercadopago/destacado-webhook',
  };
}
async function verifyAccount(accessToken) {
  const response = await fetch('https://api.mercadolibre.com/users/me', {
    headers: { Authorization: 'Bearer ' + accessToken }, signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const error = new Error(response.status === 401 || response.status === 403 ? 'MercadoPago no aceptó la credencial. Revisá tu Access Token.' : 'No se pudo verificar la cuenta en MercadoPago. Intentá nuevamente.');
    error.status = response.status === 401 || response.status === 403 ? 400 : 502;
    throw error;
  }
  const user = await response.json();
  if (!user.id || user.site_id !== 'MLA') { const error = new Error('Usá una cuenta de MercadoPago de Argentina.'); error.status = 400; throw error; }
  return { id: String(user.id), email: user.email || '', name: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.nickname || '', test: Array.isArray(user.tags) && user.tags.includes('test_user') };
}
module.exports = { encrypt, decrypt, credentials, status, verifyAccount };
