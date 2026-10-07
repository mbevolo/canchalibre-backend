const Club = require('../models/Club');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { sendMail } = require('../utils/email');
const jwt = require('jsonwebtoken');

const putClubIdAccessToken = async (req, res) => {
  try {
    const clubId = (req.params.id || '').trim();
    const { accessToken } = req.body;

    if (clubId !== String(req.clubId)) {
      return res
        .status(403)
        .json({ error: 'No autorizado para modificar este club' });
    }

    if (typeof accessToken !== 'string' || accessToken.trim().length < 10) {
      return res.status(400).json({ error: 'Access Token inválido' });
    }

    const club = await Club.findByIdAndUpdate(
      clubId,
      { mercadoPagoAccessToken: accessToken },
      { new: true },
    );

    if (!club) {
      return res
        .status(404)
        .json({ error: 'No se encontró un club con ese ID' });
    }

    res.json({ mensaje: 'Access Token guardado correctamente' });
  } catch (error) {
    console.error("🔥 Error al guardar Access Token:");
    res.status(500).json({ error: 'Error al guardar Access Token' });
  }
};

const postRegistroClub = async (req, res) => {
  const {
    email,
    password,
    nombre,
    telefono,
    direccion,
    latitud,
    longitud,
    provincia,
    localidad,
  } = req.body;

  // ✅ Validar complejidad de la contraseña
  if (
    !password ||
    password.length < 6 ||
    !/\d/.test(password) ||
    !/[A-Za-z]/.test(password)
  ) {
    return res.status(400).json({
      error:
        'La contraseña debe tener al menos 6 caracteres e incluir una letra y un número.',
    });
  }

  // ✅ Validación robusta (acepta coordenadas negativas)
  if (
    !email ||
    !password ||
    !nombre ||
    !telefono ||
    !provincia ||
    !localidad ||
    latitud === undefined ||
    longitud === undefined ||
    latitud === null ||
    longitud === null ||
    Number.isNaN(Number(latitud)) ||
    Number.isNaN(Number(longitud))
  ) {
    return res
      .status(400)
      .json({ error: 'Faltan campos obligatorios para registrar el club' });
  }

  try {
    const existe = await Club.findOne({ email });
    if (existe)
      return res.status(400).json({ error: 'El club ya está registrado' });

    // ✅ Encriptar contraseña correctamente
    const hash = await bcrypt.hash(password, 10);

    // ✅ Asegurar que las coordenadas se guarden como números reales
    const latNum = parseFloat(latitud);
    const lonNum = parseFloat(longitud);

    // ✅ Generar token de verificación (24 hs de validez)
    const token = crypto.randomBytes(32).toString('hex');
    const expira = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24 horas

    // ✅ Crear y guardar nuevo club con campos de verificación
    const nuevoClub = new Club({
      email,
      passwordHash: hash,
      nombre,
      telefono,
      direccion,
      latitud: latNum,
      longitud: lonNum,
      provincia,
      localidad,
      emailVerificado: false,
      tokenVerificacion: token,
      tokenVerificacionExpira: expira,
    });

    await nuevoClub.save();

    // ✅ Armar link de verificación (FRONT_URL ya lo usás en otros lados)
    const linkVerificacion = `${process.env.FRONT_URL}/verificar-club.html?token=${token}&email=${encodeURIComponent(email)}`;

    const html = `
      <h2>Verificá tu cuenta de club</h2>
      <p>Hola ${nombre} 👋</p>
      <p>Para activar tu acceso al panel de clubes de CanchaLibre, verificá tu email haciendo clic en el siguiente enlace:</p>
      <p><a href="${linkVerificacion}" style="color:#2c7be5;">Verificar cuenta</a></p>
      <p>Si no creaste esta cuenta, podés ignorar este mensaje.</p>
    `;

    // ✅ Usamos la misma función de envío de mail que ya tenés configurada (Brevo)
    await sendMail(email, 'Verificación de cuenta - CanchaLibre', html);

    // ✅ Mensaje al frontend
    res.json({
      mensaje:
        'Club registrado. Revisá tu email para verificar la cuenta antes de iniciar sesión.',
    });
  } catch (error) {
    console.error("❌ Error en /registro-club:");

    if (error.name === 'ValidationError') {
      return res.status(400).json({
        error: 'Todos los campos obligatorios deben completarse correctamente.',
      });
    }

    res.status(500).json({ error: 'Error al registrar club' });
  }
};

const putClubId = async (req, res) => {
  const { nombre, telefono, provincia, localidad } = req.body;

  if (String(req.params.id) !== String(req.clubId)) {
    return res
      .status(403)
      .json({ error: 'No autorizado para modificar este club' });
  }

  try {
    const club = await Club.findByIdAndUpdate(
      req.clubId,
      { nombre, telefono, provincia, localidad },
      { new: true },
    ).select(
      'nombre email telefono provincia localidad latitud longitud destacado destacadoHasta activo',
    );

    if (!club) return res.status(404).json({ error: 'Club no encontrado' });
    res.json({ ok: true, club });
  } catch (err) {
    console.error("❌ Error al actualizar club:");
    res.status(500).json({ error: 'Error al actualizar club' });
  }
};

const postLoginClub = async (req, res) => {
  const { email, password } = req.body;

  try {

    const club = await Club.findOne({ email });
    if (!club) {
      return res.status(400).json({ error: 'Club no encontrado' });
    }

    // 🔐 Verificar que el email esté confirmado
    if (!club.emailVerificado) {
      return res.status(403).json({
        error:
          'Debés verificar tu correo antes de iniciar sesión. Revisá tu email de verificación.',
      });
    }

    const match = await bcrypt.compare(password, club.passwordHash);
    if (!match) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    // ✅ Generar token JWT (ya lo tenés requerido arriba)
    const token = jwt.sign({ clubId: club._id }, process.env.JWT_SECRET, {
      expiresIn: '7d',
    });

    res.json({
      mensaje: 'Login exitoso',
      token,
      clubId: club._id,
      nombre: club.nombre,
      email: club.email,
    });
  } catch (error) {
    console.error("❌ Error en /login-club:");
    res.status(500).json({ error: 'Error al iniciar sesión del club' });
  }
};

const postClubReenviarVerificacion = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Falta el email.' });
    }

    const club = await Club.findOne({ email });
    if (!club) {
      return res
        .status(404)
        .json({ error: 'No existe un club registrado con ese email.' });
    }

    // ✅ Si ya está verificado, no tiene sentido reenviar
    if (club.emailVerificado) {
      return res
        .status(400)
        .json({
          error: 'Este correo ya fue verificado. Ya podés iniciar sesión.',
        });
    }

    // ✅ Generar nuevo token y nueva expiración (24hs)
    const token = crypto.randomBytes(32).toString('hex');
    const expira = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24 horas

    club.tokenVerificacion = token;
    club.tokenVerificacionExpira = expira;
    await club.save();

    // ✅ Armar link de verificación (usamos FRONT_URL como en el registro)
    const linkVerificacion = `${process.env.FRONT_URL}/verificar-club.html?token=${token}&email=${encodeURIComponent(email)}`;

    const html = `
      <h2>Verificá tu cuenta de club</h2>
      <p>Hola ${club.nombre} 👋</p>
      <p>Te enviamos nuevamente el enlace para verificar tu email y activar el acceso al panel de clubes de CanchaLibre.</p>
      <p><a href="${linkVerificacion}" style="color:#2c7be5;">Verificar cuenta</a></p>
      <p>Si no creaste esta cuenta, podés ignorar este mensaje.</p>
    `;

    await sendMail(email, 'Reenvío de verificación - CanchaLibre', html);

    res.json({
      ok: true,
      mensaje:
        'Te reenviamos el mail de verificación. Revisá tu bandeja de entrada o el correo no deseado.',
    });
  } catch (error) {
    console.error("❌ Error en /club/reenviar-verificacion:");
    res
      .status(500)
      .json({ error: 'Error al reenviar el mail de verificación.' });
  }
};

const getVerificarClub = async (req, res) => {
  try {
    const { email, token } = req.query;

    if (!email || !token) {
      return res.status(400).json({ error: 'Faltan parámetros.' });
    }

    const club = await Club.findOne({ email });

    if (!club) {
      return res.status(404).json({ error: 'Club no encontrado.' });
    }

    // 🔍 Validar token
    if (
      !club.tokenVerificacion ||
      club.tokenVerificacion !== token ||
      !club.tokenVerificacionExpira ||
      club.tokenVerificacionExpira < new Date()
    ) {
      return res.status(400).json({ error: 'Token inválido o expirado.' });
    }

    // ✨ Marcar como verificado
    club.emailVerificado = true;
    club.tokenVerificacion = null;
    club.tokenVerificacionExpira = null;
    club.emailVerificadoEn = new Date();

    await club.save();

    res.json({ ok: true, mensaje: 'Cuenta verificada correctamente.' });
  } catch (error) {
    console.error("❌ Error en /verificar-club:");
    res.status(500).json({ error: 'Error al verificar cuenta.' });
  }
};

const getClubEmail = async (req, res) => {
  try {
    const privateAccess = req.clubEmail === req.params.email;
    const club = await Club.findOne({ email: req.params.email }).select(
      privateAccess
        ? '-passwordHash -resetToken -resetTokenExp -tokenVerificacion -tokenVerificacionExpira'
        : '_id nombre email telefono provincia localidad latitud longitud destacado destacadoHasta mercadoPagoAccessToken',
    );
    if (!club) return res.status(404).json({ error: 'Club no encontrado' });
    const data = club.toObject();
    data.pagoOnlineDisponible = Boolean(data.mercadoPagoAccessToken);
    if (!privateAccess) delete data.mercadoPagoAccessToken;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener club' });
  }
};

const putEditarUbicacionClub = async (req, res) => {
  const { email, latitud, longitud } = req.body;
  try {
    if (email && email !== req.clubEmail)
      return res.status(403).json({ error: 'Club no autorizado' });
    await Club.findByIdAndUpdate(req.clubId, { latitud, longitud });
    res.json({ mensaje: 'Ubicación actualizada correctamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar ubicación' });
  }
};

module.exports = {
  putClubIdAccessToken,
  postRegistroClub,
  putClubId,
  postLoginClub,
  postClubReenviarVerificacion,
  getVerificarClub,
  getClubEmail,
  putEditarUbicacionClub,
};
