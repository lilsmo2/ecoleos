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

    const parentAccess = await ParentAccess.findOne({
      schoolId: school._id,
      parentPhone: phone,
      accessCode,
      status: "actif",
    });

    if (!parentAccess) {
      return res.status(401).json({ error: "Téléphone ou code d'accès incorrect" });
    }

    const student = await Student.findById(parentAccess.studentId);
    if (!student) {
      return res.status(404).json({ error: "Élève introuvable" });
    }

    const payload = {
      userId: parentAccess._id,
      schoolId: school._id,
      studentId: parentAccess.studentId,
      role: "parent",
      name: parentAccess.parentName,
    };

    const tokens = signTokens(payload);
    res.json({
      ...tokens,
      user: payload,
      studentName: student.name,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/parent/child — Get child info
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

// GET /api/parent/grades — Get child's grades
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

// GET /api/parent/attendance — Get child's attendance
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

// GET /api/parent/finances — Get child's financial records
router.get("/finances", authenticate, parentGuard, async (req, res) => {
  try {
    const finances = await Finance.find({
      schoolId: req.user.schoolId,
      deletedAt: null,
    });
    res.json(finances);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/parent/discipline — Get child's discipline records
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

// GET /api/parent/timetable — Get timetable for the child's class
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
