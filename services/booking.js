function formatearFechaDDMMYYYY(fecha) {
  const s = String(fecha || '').trim();

  // YYYY-MM-DD → DD/MM/YYYY
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const [, y, mm, dd] = m;
    return `${dd}/${mm}/${y}`;
  }

  return s;
}

function quitarAcentos(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function getDiaNombre(fecha) {
  const dias = [
    'domingo',
    'lunes',
    'martes',
    'miércoles',
    'jueves',
    'viernes',
    'sábado',
  ];
  return dias[new Date(fecha).getDay()];
}

function calcularPrecioTurno(cancha, inicioTurnoDate) {
  // nocturnoDesde: 0-23, precioNocturno: Number|null
  return precioPorHora(cancha, inicioTurnoDate.getHours());
}

function precioPorHora(cancha, hora) {
  if (
    cancha.nocturnoDesde !== null &&
    typeof cancha.nocturnoDesde === 'number'
  ) {
    if (hora >= cancha.nocturnoDesde) {
      if (
        typeof cancha.precioNocturno === 'number' &&
        !Number.isNaN(cancha.precioNocturno)
      ) {
        return cancha.precioNocturno;
      }
    }
  }
  return cancha.precio;
}

module.exports = {
  formatearFechaDDMMYYYY,
  quitarAcentos,
  getDiaNombre,
  calcularPrecioTurno,
  precioPorHora,
};
