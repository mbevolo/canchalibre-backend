const jwt = require("jsonwebtoken");
const Club = require("../models/Club");

module.exports = async function authClub(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;

  if (!token) return res.status(401).json({ error: "Token requerido" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded.clubId) {
      return res.status(401).json({ error: "Token de club inválido" });
    }

    const club = await Club.findById(decoded.clubId)
      .select("_id email activo authVersion")
      .lean();

    if (!club || (decoded.authVersion || 0) !== (club.authVersion || 0)) return res.status(401).json({ error: "Club no encontrado" });
    if (club.activo === false) {
      return res.status(403).json({ error: "Club inactivo" });
    }

    req.clubId = String(club._id);
    req.clubEmail = club.email;
    req.club = club;

    next();
  } catch (err) {
    console.error("Error verificando token club:");
    return res.status(401).json({ error: "Token inválido" });
  }
};
