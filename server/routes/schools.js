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

// POST /api/schools — create or upsert (superadmin)
// Accepts an optional client-generated id so the school's _id matches the id
// the frontend already uses as the tenant key for all per-school data.
// Idempotent: pushing the same school again updates it instead of failing.
router.post("/", authenticate, roleGuard(["superadmin"]), async (req, res) => {
  try {
    const data = pick(req.body, CREATE_FIELDS);
    if (!data.code) return res.status(400).json({ error: "Code requis" });
    const id = req.body.id || req.body._id;
    const { adminPass } = req.body;

    const doc = {
      ...data,
      code: data.code.toUpperCase(),
      plan: data.plan || "essai",
      subStatus: data.subStatus || "actif",
    };
    if (adminPass) doc.adminPassHash = await bcrypt.hash(adminPass, 10);

    let school;
    if (id) {
      school = await School.findByIdAndUpdate(
        id,
        { ...doc, _id: id },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).lean();
    } else {
      school = (await School.create(doc)).toObject();
    }
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
