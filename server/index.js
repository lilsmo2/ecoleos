import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { connectDB } from "./config/db.js";

import authRoutes from "./routes/auth.js";
import schoolRoutes from "./routes/schools.js";
import syncRoutes from "./routes/sync.js";
import licenseRoutes from "./routes/license.js";
import { createCrudRouter } from "./routes/crud.js";

import Student from "./models/Student.js";
import Staff from "./models/Staff.js";
import Finance from "./models/Finance.js";
import Budget from "./models/Budget.js";
import TuitionPayment from "./models/TuitionPayment.js";

// ── Fail closed if critical secrets are missing ──
const REQUIRED_ENV = ["JWT_SECRET", "JWT_REFRESH_SECRET", "SUPER_USER", "SUPER_PASS"];
const missing = REQUIRED_ENV.filter((k) => !process.env[k] || process.env[k].length < 16);
if (missing.length) {
  console.error(
    `[fatal] Missing or too-short required env vars: ${missing.join(", ")}. ` +
      `Set them (min 16 chars) in server/.env before starting.`
  );
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 4000;

// ── Middleware ──
app.use(helmet());

// CORS allowlist from env (comma-separated). No wildcard in production.
const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // same-origin / curl
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "1mb" }));

// Brute-force protection on auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de tentatives, réessayez plus tard." },
});
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/super-login", authLimiter);

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/schools", schoolRoutes);
app.use("/api/sync", syncRoutes);
app.use("/api/license", licenseRoutes);

// ── Per-school CRUD routes (each with an explicit field allowlist) ──
app.use(
  "/api/schools/:schoolId/students",
  createCrudRouter(Student, {
    readRoles: ["admin", "directeur", "secretaire"],
    writeRoles: ["admin", "directeur", "secretaire"],
    deleteRoles: ["admin"],
    allowedFields: [
      "name", "firstName", "lastName", "gender", "birthDate", "classId",
      "className", "parentName", "parentPhone", "parentEmail", "address",
      "enrollmentDate", "status", "notes", "photoUrl",
    ],
  })
);

app.use(
  "/api/schools/:schoolId/staff",
  createCrudRouter(Staff, {
    readRoles: ["admin", "secretaire"],
    writeRoles: ["admin"],
    deleteRoles: ["admin"],
    allowedFields: [
      "name", "username", "role", "passHash", "phone", "email",
      "hireDate", "status", "salary", "notes",
    ],
  })
);

app.use(
  "/api/schools/:schoolId/finances",
  createCrudRouter(Finance, {
    readRoles: ["admin", "comptable", "secretaire"],
    writeRoles: ["admin", "comptable", "secretaire"],
    deleteRoles: ["admin"],
    allowedFields: ["type", "category", "amount", "date", "description", "reference", "method"],
  })
);

app.use(
  "/api/schools/:schoolId/budgets",
  createCrudRouter(Budget, {
    readRoles: ["admin"],
    writeRoles: ["admin"],
    deleteRoles: ["admin"],
    allowedFields: ["category", "amount", "period", "year", "notes"],
  })
);

app.use(
  "/api/schools/:schoolId/tuition-payments",
  createCrudRouter(TuitionPayment, {
    readRoles: ["admin", "comptable", "secretaire", "directeur"],
    writeRoles: ["admin", "comptable", "secretaire"],
    deleteRoles: ["admin", "comptable"],
    allowedFields: [
      "studentId", "amount", "date", "method", "reference", "period",
      "description", "receivedBy",
    ],
  })
);

// Start
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`ÉcoleOS API running on port ${PORT}`);
  });
});
