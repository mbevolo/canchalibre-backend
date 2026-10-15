function normalizePhone(value) {
  if (typeof value !== 'string' || /[^\d+\s().-]/.test(value)) return null;
  let n = value.replace(/\D/g, '');
  if (n.startsWith('549') && n.length === 13) n = n.slice(3);
  else if (n.startsWith('54') && n.length === 12) n = n.slice(2);
  return /^[1-9]\d{9}$/.test(n) ? '549' + n : null;
}
module.exports = { normalizePhone };
