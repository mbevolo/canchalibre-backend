const Usuario = require('../models/Usuario');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { sendMail } = require('../utils/email');
const Club = require('../models/Club');

const postRegistrar = async (req, res) => {
  const { nombre, apellido, telefono, email, password } = req.body;

  try {
    if (!email || !password || !nombre || !apellido) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    // Validar contraseña
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

    const existe = await Usuario.findOne({ email });
    if (existe) return res.status(400).json({ error: 'El usuario ya existe' });

    // Normalizar teléfono
    const tel = String(telefono || '').replace(/\D/g, '');
    const telefonoNormalizado = tel.startsWith('549') ? tel : '549' + tel;

    const hash = await bcrypt.hash(password, 10);

    // Token de verificación válido por 24h
    const token = crypto.randomBytes(32).toString('hex');
    const expira = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const nuevoUsuario = new Usuario({
      nombre,
      apellido,
      telefono: telefonoNormalizado,
      email,
      password: hash,
      emailVerificado: false,
      tokenVerificacion: token,
      tokenVerificacionExpira: expira,
    });

    await nuevoUsuario.save();

    // Enviar email con Brevo
    const link = `https://canchalibre.ar/verificar-email.html?token=${token}&tipo=usuario`;

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif">
        <h2>¡Bienvenido/a a CanchaLibre!</h2>
        <p>Para activar tu cuenta, por favor verificá tu email haciendo clic en el botón:</p>
        <p>
          <a href="${link}" 
             style="background:#2c7be5;color:#fff;padding:10px 16px;border-radius:6px;
             text-decoration:none;display:inline-block">
            Verificar mi email
          </a>
        </p>
        <p>O copiá y pegá este enlace:<br>${link}</p>
        <hr/>
        <small>Este enlace vence en 24 horas.</small>
      </div>
    `;

    try {
      await sendMail(email, 'Verificá tu email en CanchaLibre', html);
    } catch (e) {
      console.error('❌ Error enviando email de verificación:', e);
    }

    return res.json({
      mensaje: 'Usuario registrado. Revisa tu email para verificar la cuenta.',
    });
  } catch (error) {
    console.error('❌ Error en /registrar:', error);
    res.status(500).json({ error: 'Error al registrar usuario' });
  }
};

const postReenviarVerificacion = async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Falta email' });

    const user = await Usuario.findOne({ email });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (user.emailVerificado)
      return res.json({ ok: true, mensaje: 'Ya estaba verificado' });

    // Nuevo token unificado
    const token = crypto.randomBytes(32).toString('hex');
    user.tokenVerificacion = token;
    user.tokenVerificacionExpira = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
    await user.save();

    // Link correcto
    const verifyLink = `https://canchalibre.ar/verificar-email.html?token=${token}&tipo=usuario`;

    console.log('[DEV] Link de verificación:', verifyLink);

    await sendMail(
      email,
      'Verificá tu email - CanchaLibre',
      `<p>Hola ${user.nombre || ''},</p>
       <p>Confirmá tu correo haciendo click aquí:</p>
       <p><a href="${verifyLink}">${verifyLink}</a></p>`,
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /reenviar-verificacion', e);
    return res.status(500).json({ error: 'Error interno' });
  }
};

const postRecuperar = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Falta el email.' });

    const usuario = await Usuario.findOne({ email });
    if (!usuario)
      return res
        .status(404)
        .json({ error: 'No existe un usuario con ese email.' });

    const token = crypto.randomBytes(32).toString('hex');
    usuario.resetToken = token;
    usuario.resetTokenExp = new Date(Date.now() + 3600000); // 1 hora
    await usuario.save();

    const link = `https://canchalibre.ar/reset.html?token=${token}&tipo=usuario`;

    await sendMail(
      usuario.email,
      'Recuperar contraseña - CanchaLibre',
      `
    <h2>Recuperación de contraseña</h2>
    <p>Hacé clic en el siguiente enlace para restablecer tu contraseña:</p>
    <p><a href="${link}" target="_blank">${link}</a></p>
    <p>Este enlace vence en 1 hora.</p>
  `,
    );

    res.json({ mensaje: 'Correo de recuperación enviado correctamente.' });
  } catch (error) {
    console.error('❌ Error en /recuperar:', error);
    res.status(500).json({ error: 'Error al procesar la recuperación.' });
  }
};

const postReset = async (req, res) => {
  try {
    const { token, nuevaPassword } = req.body;
    if (!token || !nuevaPassword)
      return res.status(400).json({ error: 'Faltan datos.' });

    const usuario = await Usuario.findOne({
      resetToken: token,
      resetTokenExp: { $gt: Date.now() },
    });

    if (!usuario)
      return res.status(400).json({ error: 'Token inválido o expirado.' });

    // Validar nueva contraseña (mínimo 6, número y letra)
    if (
      nuevaPassword.length < 6 ||
      !/\d/.test(nuevaPassword) ||
      !/[A-Za-z]/.test(nuevaPassword)
    ) {
      return res
        .status(400)
        .json({
          error:
            'La nueva contraseña debe tener al menos 6 caracteres e incluir una letra y un número.',
        });
    }

    const hash = await bcrypt.hash(nuevaPassword, 10);
    usuario.password = hash;
    usuario.resetToken = undefined;
    usuario.resetTokenExp = undefined;
    await usuario.save();

    res.json({ mensaje: 'Contraseña actualizada correctamente.' });
  } catch (error) {
    console.error('❌ Error en /reset:', error);
    res.status(500).json({ error: 'Error al restablecer contraseña.' });
  }
};

const postRecuperarClub = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Falta el email.' });

    const club = await Club.findOne({ email });
    if (!club)
      return res
        .status(404)
        .json({ error: 'No existe un club con ese email.' });

    const token = crypto.randomBytes(32).toString('hex');
    club.resetToken = token;
    club.resetTokenExp = new Date(Date.now() + 3600000); // 1 hora
    await club.save();

    const link = `https://canchalibre.ar/reset.html?token=${token}&tipo=club`;

    await sendMail(
      club.email,
      'Recuperar contraseña - CanchaLibre (Club)',
      `
    <h2>Recuperación de contraseña</h2>
    <p>Hacé clic en el siguiente enlace para restablecer tu contraseña del club:</p>
    <p><a href="${link}" target="_blank">${link}</a></p>
    <p>Este enlace vence en 1 hora.</p>
  `,
    );

    res.json({
      mensaje: 'Correo de recuperación enviado correctamente al club.',
    });
  } catch (error) {
    console.error('❌ Error en /recuperar-club:', error);
    res
      .status(500)
      .json({ error: 'Error al procesar la recuperación del club.' });
  }
};

const postResetClub = async (req, res) => {
  try {
    const { token, nuevaPassword } = req.body;
    if (!token || !nuevaPassword)
      return res.status(400).json({ error: 'Faltan datos.' });

    const club = await Club.findOne({
      resetToken: token,
      resetTokenExp: { $gt: Date.now() },
    });

    if (!club)
      return res.status(400).json({ error: 'Token inválido o expirado.' });

    if (
      nuevaPassword.length < 6 ||
      !/\d/.test(nuevaPassword) ||
      !/[A-Za-z]/.test(nuevaPassword)
    ) {
      return res
        .status(400)
        .json({
          error:
            'La nueva contraseña debe tener al menos 6 caracteres e incluir una letra y un número.',
        });
    }

    const hash = await bcrypt.hash(nuevaPassword, 10);
    club.passwordHash = hash;
    club.resetToken = undefined;
    club.resetTokenExp = undefined;
    await club.save();

    res.json({ mensaje: 'Contraseña del club actualizada correctamente.' });
  } catch (error) {
    console.error('❌ Error en /reset-club:', error);
    res
      .status(500)
      .json({ error: 'Error al restablecer contraseña del club.' });
  }
};

const getVerificarEmail = async (req, res) => {
  try {
    const { token, tipo } = req.query;

    if (!token) return res.status(400).send('Falta el token.');
    if (!tipo) return res.status(400).send('Falta el tipo (usuario o club).');

    const Modelo = tipo === 'club' ? Club : Usuario;

    const entidad = await Modelo.findOne({
      tokenVerificacion: token,
      tokenVerificacionExpira: { $gt: new Date() },
    });

    if (!entidad) {
      return res.status(400).send('Token inválido o vencido.');
    }

    entidad.emailVerificado = true;
    entidad.tokenVerificacion = undefined;
    entidad.tokenVerificacionExpira = undefined;
    await entidad.save();

    const redirectUrl =
      tipo === 'club'
        ? `https://canchalibre.ar/login-club.html?verified=1`
        : `https://canchalibre.ar/login.html?verified=1`;

    return res.redirect(redirectUrl);
  } catch (error) {
    console.error('❌ Error en /verificar-email:', error);
    res.status(500).send('Error interno al verificar email.');
  }
};

module.exports = {
  postRegistrar,
  postReenviarVerificacion,
  postRecuperar,
  postReset,
  postRecuperarClub,
  postResetClub,
  getVerificarEmail,
};
