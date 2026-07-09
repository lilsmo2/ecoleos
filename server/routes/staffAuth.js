import { Router } from "express";
import bcrypt from "bcryptjs";
import { authenticate, schoolGuard, roleGuard } from "../middleware/auth.js";
import Staff from "../models/Staff.js";

const router = Router({ mergeParams: true });

// POST /api/schools/:schoolId/staff-credentials
// Upserts a staff member's server-side login credentials with a bcrypt hash so
// they can sign in from any device. Only an admin (own school) or superadmin.
router.post("/", authenticate, schoolGuard, roleGuard(["admin", "superadmin"]), async (req, res) => {
  try {
    const { id, username, name, role, password } = req.body;
    if (!id || !username || !name || !role) {
      return res.status(400).json({ error: "id, username, name, role requis" });
    }
    const update = { _id: id, schoolId: req.params.schoolId, username, name, role, status: "actif" };
    if (password) update.passHash = await bcrypt.hash(password, 10);
    const staff = await Staff.findByIdAndUpdate(
      id, update, { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    if (staff) delete staff.passHash;
    res.status(201).json({ data: staff });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
