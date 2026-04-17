import { Router } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import School from "../models/School.js";
import Staff from "../models/Staff.js";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
if (!JWT_SECRET || !JWT_REFRESH_SECRET) {
  throw new Error("JWT_SECRET and JWT_REFRESH_SECRET are required");
}

function signTokens(payload) {
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "15m" });
  const refreshToken = jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: "7d" });
  return { token, refreshToken };
}

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { schoolCode, username, password } = req.body;
    if (!schoolCode || !username || !password) {
      return res.status(400).json({ error: "Tous les champs sont requis" });
    }

    const school = await School.findOne({ code: schoolCode.toUpperCase() });
    if (!school) {
      return res.status(401).json({ error: "Code établissement introuvable" });
    }

    // Admin login
    if (username === school.adminUser) {
      const match = school.adminPassHash
        ? await bcrypt.compare(password, school.adminPassHash)
        : false;
      if (match) {
        const payload = { userId: school._id, schoolId: school._id, role: "admin", name: "Administrateur" };
        const tokens = signTokens(payload);
        return res.json({ ...tokens, user: payload });
      }
    }

    // Staff login
    const staffMember = await Staff.findOne({ schoolId: school._id, username, status: "actif" });
    if (staffMember) {
      const match = staffMember.passHash
        ? await bcrypt.compare(password, staffMember.passHash)
        : false;
      if (match) {
        const payload = { userId: staffMember._id, schoolId: school._id, role: staffMember.role, name: staffMember.name };
        const tokens = signTokens(payload);
        return res.json({ ...tokens, user: payload });
      }
    }

    return res.status(401).json({ error: "Identifiant ou mot de passe incorrect" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/refresh
router.post("/refresh", (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: "Refresh token requis" });

  try {
    const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    const { iat, exp, ...payload } = decoded;
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "15m" });
    res.json({ token });
  } catch {
    res.status(401).json({ error: "Refresh token invalide" });
  }
});

// POST /api/auth/super-login
router.post("/super-login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const superUser = process.env.SUPER_USER;
    const superPass = process.env.SUPER_PASS;
    if (!superUser || !superPass) {
      return res.status(500).json({ error: "Super admin non configuré" });
    }

    if (username === superUser && password === superPass) {
      const payload = { userId: "super", schoolId: null, role: "superadmin", name: "Super Admin" };
      const tokens = signTokens(payload);
      return res.json({ ...tokens, user: payload });
    }
    res.status(401).json({ error: "Identifiants incorrects" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
