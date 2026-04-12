import { Router } from "express";
import jwt from "jsonwebtoken";
import School from "../models/School.js";
import Student from "../models/Student.js";
import ParentAccess from "../models/ParentAccess.js";
import Attendance from "../models/Attendance.js";
import Grade from "../models/Grade.js";
import Finance from "../models/Finance.js";
import Discipline from "../models/Discipline.js";
import Timetable from "../models/Timetable.js";
import Announcement from "../models/Announcement.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "change_me_to_a_random_string_in_production";
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "change_me_to_another_random_string";

function signTokens(payload) {
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "15m" });
  const refreshToken = jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: "7d" });
  return { token, refreshToken };
}

function parentGuard(req, res, next) {
  if (!req.user || req.user.role !== "parent") {
    return res.status(403).json({ error: "Accès refusé" });
  }
  next();
}

// POST /api/parent/login — Parent login
// Authenticates by phone + accessCode + schoolCode.
// Returns all children linked to this phone number at that school.
router.post("/login", async (req, res) => {
  try {
    const { phone, accessCode, schoolCode } = req.body;
    if (!phone || !accessCode || !schoolCode) {
      return res.status(400).json({ error: "Tous les champs sont requis" });
    }

    const school = await School.findOne({ code: schoolCode.toUpperCase() });
    if (!school) {
      return res.status(401).json({ error: "Code établissement introuvable" });
    }

    // Verify the access code belongs to this phone at this school
    const parentAccess = await ParentAccess.findOne({
      schoolId: school._id,
      parentPhone: phone,
      accessCode,
      status: "actif",
    });

    if (!parentAccess) {
      return res.status(401).json({ error: "Téléphone ou code d'accès incorrect" });
    }

    // Find ALL children linked to this phone number at this school
    const allAccess = await ParentAccess.find({
      schoolId: school._id,
      parentPhone: phone,
      status: "actif",
    });

    const children = [];
    for (const access of allAccess) {
      const student = await Student.findById(access.studentId).lean();
      if (student) {
        children.push({
          studentId: String(student._id),
          name: student.name,
          grade: student.grade || student.classe || "",
          photo: student.photo || null,
          accessId: String(access._id),
        });
      }
    }

    // Default active child is the one matching the access code used
    const activeStudentId = String(parentAccess.studentId);

    const payload = {
      userId: String(parentAccess._id),
      schoolId: String(school._id),
      studentId: activeStudentId,      // currently active child
      parentPhone: phone,               // stored so we can switch children
      role: "parent",
      name: parentAccess.parentName,
    };

    const tokens = signTokens(payload);
    res.json({
      ...tokens,
      user: payload,
      children,                          // full list of all children
      activeStudentId,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/parent/switch-child — Switch active child (re-issues tokens)
router.post("/switch-child", authenticate, parentGuard, async (req, res) => {
  try {
    const { studentId } = req.body;
    if (!studentId) return res.status(400).json({ error: "studentId requis" });

    // Verify this student is actually linked to the parent's phone
    const access = await ParentAccess.findOne({
      schoolId: req.user.schoolId,
      parentPhone: req.user.parentPhone,
      studentId,
      status: "actif",
    });

    if (!access) {
      return res.status(403).json({ error: "Enfant introuvable pour ce parent" });
    }

    const student = await Student.findById(studentId).lean();
    if (!student) return res.status(404).json({ error: "Élève introuvable" });

    // Issue new tokens with the switched child
    const payload = {
      userId: String(access._id),
      schoolId: req.user.schoolId,
      studentId: String(studentId),
      parentPhone: req.user.parentPhone,
      role: "parent",
      name: req.user.name,
    };

    const tokens = signTokens(payload);
    res.json({ ...tokens, user: payload, studentName: student.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/parent/children — List all children for this parent
router.get("/children", authenticate, parentGuard, async (req, res) => {
  try {
    const allAccess = await ParentAccess.find({
      schoolId: req.user.schoolId,
      parentPhone: req.user.parentPhone,
      status: "actif",
    });

    const children = [];
    for (const access of allAccess) {
      const student = await Student.findById(access.studentId).lean();
      if (student) {
        children.push({
          studentId: String(student._id),
          name: student.name,
          grade: student.grade || student.classe || "",
          photo: student.photo || null,
          isActive: String(student._id) === String(req.user.studentId),
        });
      }
    }
    res.json(children);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/parent/child — Get current active child info
router.get("/child", authenticate, parentGuard, async (req, res) => {
  try {
    const student = await Student.findById(req.user.studentId);
    if (!student) {
      return res.status(404).json({ error: "Élève introuvable" });
    }
    res.json(student);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/parent/grades — Get active child's grades
router.get("/grades", authenticate, parentGuard, async (req, res) => {
  try {
    const grades = await Grade.find({
      schoolId: req.user.schoolId,
      studentId: req.user.studentId,
      deletedAt: null,
    }).sort({ date: -1 });
    res.json(grades);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/parent/attendance — Get active child's attendance
router.get("/attendance", authenticate, parentGuard, async (req, res) => {
  try {
    const attendance = await Attendance.find({
      schoolId: req.user.schoolId,
      studentId: req.user.studentId,
      deletedAt: null,
    }).sort({ date: -1 });
    res.json(attendance);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/parent/finances — Get active child's financial records
router.get("/finances", authenticate, parentGuard, async (req, res) => {
  try {
    const finances = await Finance.find({
      schoolId: req.user.schoolId,
      studentId: req.user.studentId,
      deletedAt: null,
    });
    res.json(finances);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/parent/discipline — Get active child's discipline records
router.get("/discipline", authenticate, parentGuard, async (req, res) => {
  try {
    const discipline = await Discipline.find({
      schoolId: req.user.schoolId,
      studentId: req.user.studentId,
      deletedAt: null,
    }).sort({ date: -1 });
    res.json(discipline);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/parent/timetable — Get timetable for active child's class
router.get("/timetable", authenticate, parentGuard, async (req, res) => {
  try {
    const student = await Student.findById(req.user.studentId);
    if (!student) {
      return res.status(404).json({ error: "Élève introuvable" });
    }

    const timetable = await Timetable.find({
      schoolId: req.user.schoolId,
      classId: student.grade,
      deletedAt: null,
    }).sort({ day: 1, startTime: 1 });
    res.json(timetable);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/parent/announcements — Get school announcements
router.get("/announcements", authenticate, parentGuard, async (req, res) => {
  try {
    const announcements = await Announcement.find({
      schoolId: req.user.schoolId,
      audience: { $in: ["all", "parents"] },
      deletedAt: null,
    }).sort({ date: -1 });
    res.json(announcements);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
