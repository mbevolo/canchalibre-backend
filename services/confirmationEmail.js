const { sendMail } = require('../utils/email');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function confirmationHtml(turno, cancha, club) {
  const fecha = String(turno.fecha).split('-').reverse().join('/');
  const pago = turno.pagado ? 'Pagado' : turno.metodoPago === 'online' ? 'Mercado Pago · pendiente de pago' : 'Efectivo · pendiente de pago en el club';
  const rows = {
    Club: club?.nombre || 'Club', Cancha: cancha.nombre, Deporte: cancha.deporte,
    Fecha: fecha, Hora: turno.hora, Duración: `${cancha.duracionTurno || 60} minutos`,
    Importe: new Intl.NumberFormat('es-AR', {style:'currency',currency:'ARS'}).format(Number(turno.precio || 0)),
    Pago: pago, 'Número de reserva': String(turno._id),
  };
  return `<div style="font-family:Arial,sans-serif"><h2>Tu reserva está confirmada</h2><p>Guardá estos datos para tu próximo turno.</p><table>${Object.entries(rows).map(([key,value]) => `<tr><th style="text-align:left;padding:6px">${escape(key)}</th><td style="padding:6px">${escape(value)}</td></tr>`).join('')}</table><p>Podés consultar tu reserva desde Mi cuenta en CanchaLibre.</p></div>`;
}
async function sendConfirmationEmail(turno, cancha, club, email) {
  try {
    await sendMail(email, 'Reserva confirmada · CanchaLibre', confirmationHtml(turno, cancha, club));
    return true;
  } catch (_) {
    // La reserva ya está confirmada: un fallo de correo no debe revertirla.
    console.error('No se pudo enviar el resumen de la reserva confirmada:');
    return false;
  }
}
module.exports = { confirmationHtml, sendConfirmationEmail };
