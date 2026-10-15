const Config = require('../models/config');
const { encrypt, decrypt } = require('./platformMercadoPago');
const { normalizePhone } = require('../utils/phone');
const { sendMail } = require('../utils/email');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const settings = () => Config.findOne().select('+greenTokenEncrypted');
function publicSettings(c) { return { channel: c?.reservationChannel || 'email', configured: Boolean(c?.greenInstanceId && c?.greenTokenEncrypted), instanceId: c?.greenInstanceId || '', apiUrl: c?.greenApiUrl || 'https://api.green-api.com' }; }
async function greenRequest(c, method, body) {
  if (!publicSettings(c).configured) throw Object.assign(new Error('WhatsApp aún no está configurado.'), { status: 503 });
  const response = await fetch(`${c.greenApiUrl || 'https://api.green-api.com'}/waInstance${c.greenInstanceId}/${method}/${decrypt(c.greenTokenEncrypted)}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000), redirect: 'error' });
  if (!response.ok) throw new Error('No se pudo contactar con WhatsApp');
  return response.json();
}
async function sendWhatsApp(c, phone, message) {
  const n = normalizePhone(phone);
  if (!n) throw Object.assign(new Error('Completá un celular válido en Mi cuenta: código de área y número, sin 0 ni 15.'), { status: 400 });
  const result = await greenRequest(c, 'sendMessage', { chatId: n + '@c.us', message, linkPreview: false });
  if (!result.idMessage) throw new Error('WhatsApp no aceptó el mensaje');
}
async function sendPending(r, user, cancha, club, c) {
  c = c || await settings();
  const channel = publicSettings(c).channel;
  const link = `${process.env.FRONT_URL}/confirmar-reserva.html?id=${r._id}&code=${r.codigoOTP}`;
  const message = `CanchaLibre · Confirmá tu reserva\nClub: ${club?.nombre || 'Club'}\nCancha: ${cancha?.nombre || 'Cancha'}\nFecha: ${r.fecha}\nHora: ${r.hora}\nCódigo: ${r.codigoOTP}\nAbrí el enlace para confirmar (vence en 10 minutos):\n${link}\nSi no solicitaste esta reserva, ignorá el mensaje.`;
  if (channel === 'whatsapp') await sendWhatsApp(c, user.telefono, message);
  else await sendMail(user.email, 'Confirmá tu reserva en CanchaLibre', `<p>${escape(message).replace(/\n/g, '<br>')}</p><p><a href="${escape(link)}">Confirmar reserva</a></p>`);
  return channel;
}
async function sendConfirmed(turno, cancha, club, r) {
  try {
    if ((r.canalConfirmacion || 'email') === 'whatsapp') await sendWhatsApp(await settings(), r.telefonoContacto, `CanchaLibre · Reserva confirmada\nClub: ${club?.nombre || 'Club'}\nCancha: ${cancha.nombre}\nFecha: ${turno.fecha}\nHora: ${turno.hora}\nImporte: $${turno.precio}\nPago: ${turno.pagado ? 'Pagado' : 'Pendiente'}\nConsultá el turno en Mi cuenta.`);
    else await require('./confirmationEmail').sendConfirmationEmail(turno, cancha, club, r.emailContacto);
  } catch (_) { console.error('No se pudo enviar el resumen de reserva'); }
}
module.exports = { settings, publicSettings, greenRequest, sendPending, sendConfirmed, encrypt };
