// Read-only: native collection queries never create indexes or update records.
async function dataAudit(db) {
  const count = async (collection, pipeline) => (await db.collection(collection).aggregate([...pipeline, { $count: 'count' }]).toArray())[0]?.count || 0;
  const duplicates = (collection, match) => count(collection, [
    ...(match ? [{ $match: match }] : []),
    { $group: { _id: { canchaId: { $toString: '$canchaId' }, fecha: '$fecha', hora: '$hora' }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } }
  ]);
  const orphanCourt = collection => count(collection, [
    { $lookup: { from: 'canchas', let: { id: { $toString: '$canchaId' } }, pipeline: [{ $match: { $expr: { $eq: [{ $toString: '$_id' }, '$$id'] } } }], as: 'court' } },
    { $match: { court: { $size: 0 } } }
  ]);
  const results = await Promise.all([
    duplicates('turnos'), duplicates('reservas', { estado: 'CONFIRMED' }),
    orphanCourt('turnos'), orphanCourt('reservas'),
    count('canchas', [{ $lookup: { from: 'clubs', localField: 'clubEmail', foreignField: 'email', as: 'club' } }, { $match: { club: { $size: 0 } } }]),
    count('reservas', [{ $match: { estado: 'CONFIRMED' } }, { $lookup: {
      from: 'turnos', let: { id: { $toString: '$canchaId' }, date: '$fecha', hour: '$hora' }, pipeline: [{ $match: { $expr: { $and: [
        { $eq: ['$canchaId', '$$id'] }, { $eq: ['$fecha', '$$date'] }, { $eq: ['$hora', '$$hour'] },
        { $ne: [{ $ifNull: ['$usuarioReservado', null] }, null] }, { $ne: ['$usuarioReservado', ''] }
      ] } } }], as: 'slot' } }, { $match: { slot: { $size: 0 } } }]),
    db.collection('turnos').countDocuments({ pagado: true, $or: [{ usuarioReservado: null }, { usuarioReservado: '' }] }),
    db.collection('turnos').countDocuments({ usuarioReservado: { $nin: [null, ''] }, $or: [{ bookingId: null }, { bookingId: '' }] }),
    db.collection('reservas').countDocuments({ estado: 'PENDING', expiresAt: { $lte: new Date() } })
  ]);
  let indexes = [];
  try { indexes = await db.collection('turnos').listIndexes().toArray(); } catch (error) { if (error.code !== 26) throw error; }
  const keys = ['duplicateSlotGroups', 'duplicateConfirmedGroups', 'slotsWithoutCourt', 'reservationsWithoutCourt', 'courtsWithoutClub', 'confirmedWithoutBookedSlot', 'paidWithoutBooking', 'legacyBookingsWithoutReference', 'expiredPending'];
  return {
    counts: Object.fromEntries(keys.map((key, index) => [key, results[index]])),
    uniqueSlotIndex: indexes.some(i => i.unique && Object.keys(i.key).join(',') === 'canchaId,fecha,hora'),
    notes: ['Counts only; no customer data or credentials.', 'No repairs performed.', 'Run against a development copy with read-only credentials.']
  };
}
module.exports = { dataAudit };
