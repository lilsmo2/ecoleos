import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET is required");

export function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token requis" });
  }

  try {
    const token = header.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { userId, schoolId, role, name }
    next();
  } catch {
    return res.status(401).json({ error: "Token invalide ou expiré" });
  }
}

export function roleGuard(roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Accès refusé" });
    }
    next();
  };
}

export function schoolGuard(req, res, next) {
  // Ensure user can only access their own school's data
  const { schoolId } = req.params;
  if (schoolId && req.user.role !== "superadmin" && req.user.schoolId !== schoolId) {
    return res.status(403).json({ error: "Accès refusé à cet établissement" });
  }
  next();
}
