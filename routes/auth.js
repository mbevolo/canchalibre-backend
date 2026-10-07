const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const Usuario = require('../models/Usuario');
const UserSession = require('../models/UserSession');
const authUser = require('../middlewares/authUser');

const router = express.Router();

const ACCESS_TTL = '15m';
const REFRESH_DAYS = 30;

function getCookie(req, name) {
  const header = req.headers.cookie || '';
  const item = header.split(';').map(v => v.trim()).find(v => v.startsWith(name + '='));
  if (!item) return null;
  try { return decodeURIComponent(item.slice(name.length + 1)); } catch (_) { return null; }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function issueAccessToken(usuario) {
  return jwt.sign(
    { sub: String(usuario._id), role: 'user', type: 'access' },
    process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET,
    {
      expiresIn: ACCESS_TTL,
      issuer: process.env.JWT_ISSUER || 'canchalibre-api',
      audience: process.env.JWT_AUDIENCE || 'canchalibre-web',
      jwtid: crypto.randomUUID()
    }
  );
}

function setRefreshCookie(res, token) {
  const maxAge = REFRESH_DAYS * 24 * 60 * 60 * 1000;
  const securePart = process.env.NODE_ENV === 'production' ? ' Secure;' : '';
  res.setHeader(
    'Set-Cookie',
    `canchalibre_refresh=${encodeURIComponent(token)}; Max-Age=${Math.floor(maxAge / 1000)}; Path=/auth; HttpOnly;${securePart} SameSite=Lax`
  );
}

function clearRefreshCookie(res) {
  const securePart = process.env.NODE_ENV === 'production' ? ' Secure;' : '';
  res.setHeader(
    'Set-Cookie',
    `canchalibre_refresh=; Max-Age=0; Path=/auth; HttpOnly;${securePart} SameSite=Lax`
  );
}

async function createSession(usuario, req, res) {
  const refreshToken = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000);

  await UserSession.create({
    usuarioId: usuario._id,
    tokenHash: hashToken(refreshToken),
    expiresAt,
    userAgent: String(req.get('user-agent') || '').slice(0, 500),
    ip: String(req.ip || '').slice(0, 100)
  });

  setRefreshCookie(res, refreshToken);
  return issueAccessToken(usuario);
}

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Faltan credenciales' });

    const usuario = await Usuario.findOne({ email: String(email).trim().toLowerCase() });
    const hash = usuario?.passwordHash || usuario?.password;
    const valid = usuario && hash ? await bcrypt.compare(password, hash) : false;

    if (!valid) return res.status(401).json({ error: 'Email o contraseña incorrectos' });

    const verified = Boolean(usuario.emailVerified ?? usuario.emailVerificado ?? false);
    if (!verified) return res.status(403).json({ error: 'Debes verificar tu email antes de iniciar sesión' });
    if (usuario.activo === false) return res.status(403).json({ error: 'La cuenta está inactiva' });

    const accessToken = await createSession(usuario, req, res);

    return res.json({
      ok: true,
      accessToken,
      user: {
        id: String(usuario._id),
        nombre: usuario.nombre || '',
        apellido: usuario.apellido || '',
        email: usuario.email,
        telefono: usuario.telefono || ''
      }
    });
  } catch (error) {
    console.error("❌ Error en /auth/login:");
    return res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    const token = getCookie(req, 'canchalibre_refresh');
    if (!token) return res.status(401).json({ error: 'Sesión no disponible' });

    const session = await UserSession.findOneAndUpdate({
      tokenHash: hashToken(token),
      revokedAt: null,
      expiresAt: { $gt: new Date() }
    }, { $set: { revokedAt: new Date(), lastUsedAt: new Date() } }, { new: true });

    if (!session) {
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Sesión inválida o expirada' });
    }

    const usuario = await Usuario.findById(session.usuarioId);
    if (!usuario || usuario.activo === false || !usuario.emailVerificado) {
      session.revokedAt = new Date();
      await session.save();
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Cuenta no disponible' });
    }

    const accessToken = await createSession(usuario, req, res);

    return res.json({
      ok: true,
      accessToken,
      user: {
        id: String(usuario._id),
        nombre: usuario.nombre || '',
        apellido: usuario.apellido || '',
        email: usuario.email,
        telefono: usuario.telefono || ''
      }
    });
  } catch (error) {
    console.error("❌ Error en /auth/refresh:");
    clearRefreshCookie(res);
    return res.status(500).json({ error: 'No se pudo renovar la sesión' });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const token = getCookie(req, 'canchalibre_refresh');
    if (token) {
      await UserSession.updateOne(
        { tokenHash: hashToken(token), revokedAt: null },
        { $set: { revokedAt: new Date() } }
      );
    }
    clearRefreshCookie(res);
    return res.json({ ok: true });
  } catch (error) {
    clearRefreshCookie(res);
    return res.json({ ok: true });
  }
});

router.post('/logout-all', authUser, async (req, res) => {
  await UserSession.updateMany(
    { usuarioId: req.userId, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
  clearRefreshCookie(res);
  return res.json({ ok: true });
});

router.get('/me', authUser, async (req, res) => {
  const usuario = await Usuario.findById(req.userId).select(
    '_id nombre apellido telefono email activo emailVerificado emailVerified'
  ).lean();

  if (!usuario || usuario.activo === false) return res.status(404).json({ error: 'Usuario no encontrado' });

  return res.json({
    id: String(usuario._id),
    nombre: usuario.nombre || '',
    apellido: usuario.apellido || '',
    telefono: usuario.telefono || '',
    email: usuario.email,
    emailVerificado: Boolean(usuario.emailVerified ?? usuario.emailVerificado ?? false)
  });
});

router.patch('/me', authUser, async (req, res) => {
  const { nombre, apellido, telefono } = req.body || {};

  const usuario = await Usuario.findByIdAndUpdate(
    req.userId,
    { $set: { nombre, apellido, telefono } },
    { new: true, runValidators: true }
  ).select('_id nombre apellido telefono email');

  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

  return res.json({
    mensaje: 'Datos actualizados correctamente',
    user: {
      id: String(usuario._id),
      nombre: usuario.nombre || '',
      apellido: usuario.apellido || '',
      telefono: usuario.telefono || '',
      email: usuario.email
    }
  });
});

module.exports = router;
