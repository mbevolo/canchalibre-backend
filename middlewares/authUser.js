const jwt = require('jsonwebtoken');

module.exports = function authUser(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;

  if (!token) return res.status(401).json({ error: 'Autenticación requerida' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET, {
      issuer: process.env.JWT_ISSUER || 'canchalibre-api',
      audience: process.env.JWT_AUDIENCE || 'canchalibre-web'
    });

    if (decoded.type !== 'access' || decoded.role !== 'user' || !decoded.sub) {
      return res.status(401).json({ error: 'Token de usuario inválido' });
    }

    req.userId = String(decoded.sub);
    req.userToken = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
};
