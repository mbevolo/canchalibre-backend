const { MongoClient } = require('mongoose').mongo;
const { dataAudit } = require('../utils/dataAudit');
(async () => {
  const uri = process.env.MONGO_AUDIT_URI, database = process.env.MONGO_AUDIT_DB;
  if (!uri || !database || !/(?:^|_)(?:dev|development|test)(?:_|$)/i.test(database)) {
    throw new Error('Set MONGO_AUDIT_URI and MONGO_AUDIT_DB naming an explicit development/test copy.');
  }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try { await client.connect(); console.log(JSON.stringify(await dataAudit(client.db(database)), null, 2)); }
  finally { await client.close(); }
})().catch(() => { console.error('Audit failed. Check development database name, connectivity and read-only access. No data changed.'); process.exitCode = 1; });
