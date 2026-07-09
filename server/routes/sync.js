import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import Student from "../models/Student.js";
import Staff from "../models/Staff.js";
import Finance from "../models/Finance.js";
import Budget from "../models/Budget.js";
import Attendance from "../models/Attendance.js";
import Grade from "../models/Grade.js";
import Discipline from "../models/Discipline.js";
import Timetable from "../models/Timetable.js";
import Announcement from "../models/Announcement.js";
import ParentAccess from "../models/ParentAccess.js";
import Store from "../models/Store.js";
import TuitionPayment from "../models/TuitionPayment.js";

const router = Router();

const MODELS = {
  students: Student,
  staff: Staff,
  finances: Finance,
  budgets: Budget,
  attendance: Attendance,
  grades: Grade,
  discipline: Discipline,
  timetable: Timetable,
  announcements: Announcement,
  parentaccess: ParentAccess,
  "tuition-payments": TuitionPayment,
};

// Typed collections the server queries directly (login lookups, reports).
// Everything else is stored generically (see Store) so a second device can
// still pull it back.
const TYPED = {
  stu: "students",
  stf: "staff",
  fin: "finances",
  bud: "budgets",
  stup: "tuition-payments",
};

// Never accept client-side password hashes over sync — credentials are set
// server-side with bcrypt via the dedicated auth/credential routes.
function stripHashes(item) {
  const out = { ...item };
  delete out.passHash;
  delete out.adminPassHash;
  return out;
}

// POST /api/sync/push — push local changes to server
router.post("/push", authenticate, async (req, res) => {
  try {
    const { key, data } = req.body;
    if (!key || data === undefined) return res.status(400).json({ error: "key and data required" });

    const typedMatch = key.match(/^eos3_(stu|stf|fin|bud|stup)_(.+)$/);
    if (typedMatch) {
      const modelName = TYPED[typedMatch[1]];
      const schoolId = typedMatch[2];
      const Model = MODELS[modelName];
      if (!Model) return res.status(400).json({ error: "Unknown entity type" });
      if (req.user.role !== "superadmin" && req.user.schoolId !== schoolId) {
        return res.status(403).json({ error: "Accès refusé" });
      }

      const ops = Array.isArray(data) ? data : [];
      for (const item of ops) {
        const id = item.id || item._id;
        await Model.findByIdAndUpdate(
          id,
          { ...stripHashes(item), _id: id, schoolId },
          { upsert: true, new: true }
        );
      }
      // Soft-delete records removed locally
      const pushedIds = ops.map(i => i.id || i._id).filter(Boolean);
      if (pushedIds.length > 0) {
        await Model.updateMany(
          { schoolId, _id: { $nin: pushedIds }, deletedAt: null },
          { deletedAt: new Date() }
        );
      }
      return res.json({ success: true, count: ops.length });
    }

    // ── Generic store for every other key (arrays or singleton objects) ──
    let schoolId = null;
    if (key === "eos3_super_payments") {
      if (req.user.role !== "superadmin") return res.status(403).json({ error: "Accès refusé" });
    } else {
      const m = key.match(/^eos3_[a-z]+_(.+)$/);
      if (!m) return res.status(400).json({ error: "Unknown key format" });
      schoolId = m[1];
      if (req.user.role !== "superadmin" && req.user.schoolId !== schoolId) {
        return res.status(403).json({ error: "Accès refusé" });
      }
    }
    await Store.findByIdAndUpdate(
      key,
      { _id: key, schoolId, data },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sync/pull — pull server changes since lastSync
router.post("/pull", authenticate, async (req, res) => {
  try {
    const { schoolId, types, lastSync } = req.body;
    if (!schoolId) return res.status(400).json({ error: "schoolId required" });

    if (req.user.role !== "superadmin" && req.user.schoolId !== schoolId) {
      return res.status(403).json({ error: "Accès refusé" });
    }

    const since = lastSync ? new Date(lastSync) : new Date(0);
    const result = {};

    const requestedTypes = types || Object.keys(MODELS);
    for (const type of requestedTypes) {
      const Model = MODELS[type];
      if (!Model) continue;
      result[type] = await Model.find({
        schoolId,
        updatedAt: { $gte: since },
      }).lean();
    }

    res.json({ data: result, syncedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
