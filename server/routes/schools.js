import { Router } from "express";
import bcrypt from "bcryptjs";
import School from "../models/School.js";
import { authenticate, roleGuard } from "../middleware/auth.js";

const router = Router();

// GET /api/schools — list all (superadmin)
router.get("/", authenticate, roleGuard(["superadmin"]), async (req, res) => {
  try {
    const schools = await School.find().lean();
    res.json({ data: schools });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/schools/:id — get one school
router.get("/:id", authenticate, async (req, res) => {
  try {
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
    const { _id, name, city, code, adminUser, adminPass, plan, subEnd, subStatus } = req.body;
    const adminPassHash = adminPass ? await bcrypt.hash(adminPass, 10) : undefined;
    const school = await School.create({
      _id, name, city, code: code.toUpperCase(), adminUser, adminPassHash,
      plan: plan || "essai", subEnd, subStatus: subStatus || "actif",
    });
    res.status(201).json({ data: school });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/schools/:id — update
router.put("/:id", authenticate, roleGuard(["superadmin", "admin"]), async (req, res) => {
  try {
    const updates = { ...req.body };
    if (updates.adminPass) {
      updates.adminPassHash = await bcrypt.hash(updates.adminPass, 10);
      delete updates.adminPass;
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
