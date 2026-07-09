import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import Store from "../models/Store.js";

const router = Router();

// Extract the schoolId embedded in a storage key. Returns null for global keys.
export function schoolIdFromKey(key) {
  if (key === "eos3_super_payments") return null; // global (superadmin)
  const m = key.match(/^eos3_[a-z]+_(.+)$/);
  return m ? m[1] : undefined; // undefined => malformed
}

function canAccess(user, key) {
  const sid = schoolIdFromKey(key);
  if (sid === undefined) return false;          // malformed key
  if (user.role === "superadmin") return true;
  if (sid === null) return false;               // global key, non-super
  return String(user.schoolId) === String(sid); // own school only
}

// GET /api/store/:key — read a generic blob (404 when absent so the client
// keeps its local copy instead of overwriting it with null).
router.get("/:key", authenticate, async (req, res) => {
  try {
    const { key } = req.params;
    if (!canAccess(req.user, key)) return res.status(403).json({ error: "Accès refusé" });
    const doc = await Store.findById(key).lean();
    if (!doc) return res.status(404).json({ error: "Introuvable" });
    res.json({ data: doc.data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
