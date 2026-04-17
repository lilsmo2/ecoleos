import { Router } from "express";
import bcrypt from "bcryptjs";
import School from "../models/School.js";
import { authenticate, roleGuard } from "../middleware/auth.js";

const router = Router();

// Fields clients are permitted to write via POST/PUT.
// Never includes _id or anything that would escalate privileges implicitly.
const CREATE_FIELDS = ["name", "city", "code", "adminUser", "plan", "subEnd", "subStatus"];
const UPDATE_FIELDS = ["name", "city", "adminUser", "plan", "subEnd", "subStatus"];

function pick(body, fields) {
  const out = {};
  for (const k of fields) {
    if (Object.prototype.hasOwnProperty.call(body, k)) out[k] = body[k];
  }
  return out;
}

// GET /api/schools — list all (superadmin)
router.get("/", authenticate, roleGuard(["superadmin"]), async (req, res) => {
  try {
    const schools = await School.find().lean();
    res.json({ data: schools });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/schools/:id — get one school (superadmin, or the school's own admin)
router.get("/:id", authenticate, async (req, res) => {
  try {
    if (req.user.role !== "superadmin" && String(req.user.schoolId) !== String(req.params.id)) {
      return res.status(403).json({ error: "Accès refusé" });
    }
    const school = await School.findById(req.params.id).lean();
    if (!school) return res.status(404).json({ error: "Établissement introuvable" });
    res.json({ data: school });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/schools — create (superadmin)
router.post("/", authenticate, roleGuard(["superadmin"]), async (req, res) => {
  try {
    const data = pick(req.body, CREATE_FIELDS);
    if (!data.code) return res.status(400).json({ error: "Code requis" });
    const { adminPass } = req.body;
    const adminPassHash = adminPass ? await bcrypt.hash(adminPass, 10) : undefined;
    const school = await School.create({
      ...data,
      code: data.code.toUpperCase(),
      adminPassHash,
      plan: data.plan || "essai",
      subStatus: data.subStatus || "actif",
    });
    res.status(201).json({ data: school });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/schools/:id — update (superadmin, or the school's own admin)
router.put("/:id", authenticate, roleGuard(["superadmin", "admin"]), async (req, res) => {
  try {
    // An admin may only update their own school. Superadmin may update any.
    if (req.user.role === "admin" && String(req.user.schoolId) !== String(req.params.id)) {
      return res.status(403).json({ error: "Accès refusé" });
    }
    const updates = pick(req.body, UPDATE_FIELDS);
    if (req.body.adminPass) {
      updates.adminPassHash = await bcrypt.hash(req.body.adminPass, 10);
    }
    const school = await School.findByIdAndUpdate(req.params.id, updates, { new: true }).lean();
    if (!school) return res.status(404).json({ error: "Établissement introuvable" });
    res.json({ data: school });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/schools/:id — delete (superadmin)
router.delete("/:id", authenticate, roleGuard(["superadmin"]), async (req, res) => {
  try {
    await School.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
