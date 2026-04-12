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

// POST /api/sync/push — push local changes to server
router.post("/push", authenticate, async (req, res) => {
  try {
    const { key, data } = req.body;
    if (!key || !data) return res.status(400).json({ error: "key and data required" });

    // Parse key to determine model: eos3_stu_xxx → students
    const match = key.match(/^eos3_(stu|stf|fin|bud|att|grd|dsc|tmt|msg|par|stup)_(.+)$/);
    if (!match) return res.status(400).json({ error: "Unknown key format" });

    const typeMap = {
      stu: "students",
      stf: "staff",
      fin: "finances",
      bud: "budgets",
      att: "attendance",
      grd: "grades",
      dsc: "discipline",
      tmt:  "timetable",
      msg:  "announcements",
      par:  "parentaccess",
      stup: "tuition-payments",
    };
    const modelName = typeMap[match[1]];
    const schoolId = match[2];
    const Model = MODELS[modelName];

    if (!Model) return res.status(400).json({ error: "Unknown entity type" });

    // Verify user has access to this school
    if (req.user.role !== "superadmin" && req.user.schoolId !== schoolId) {
      return res.status(403).json({ error: "Accès refusé" });
    }

    // Upsert all records
    const ops = Array.isArray(data) ? data : [];
    for (const item of ops) {
      await Model.findByIdAndUpdate(
        item.id || item._id,
        { ...item, _id: item.id || item._id, schoolId },
        { upsert: true, new: true }
      );
    }

    // Remove records not in the pushed list (they were deleted locally)
    const pushedIds = ops.map(i => i.id || i._id).filter(Boolean);
    if (pushedIds.length > 0) {
      await Model.updateMany(
        { schoolId, _id: { $nin: pushedIds }, deletedAt: null },
        { deletedAt: new Date() }
      );
    }

    res.json({ success: true, count: ops.length });
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
