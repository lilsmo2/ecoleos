import "dotenv/config";
import express from "express";
import cors from "cors";
import { connectDB } from "./config/db.js";

import authRoutes from "./routes/auth.js";
import schoolRoutes from "./routes/schools.js";
import syncRoutes from "./routes/sync.js";
import parentRoutes from "./routes/parent.js";
import { createCrudRouter } from "./routes/crud.js";

import Student from "./models/Student.js";
import Staff from "./models/Staff.js";
import Finance from "./models/Finance.js";
import Budget from "./models/Budget.js";
import Attendance from "./models/Attendance.js";
import Grade from "./models/Grade.js";
import Discipline from "./models/Discipline.js";
import Timetable from "./models/Timetable.js";
import Announcement from "./models/Announcement.js";

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/schools", schoolRoutes);
app.use("/api/sync", syncRoutes);
app.use("/api/parent", parentRoutes);

// Per-school CRUD routes
app.use("/api/schools/:schoolId/students", createCrudRouter(Student, {
  readRoles: ["admin", "directeur", "secretaire"],
  writeRoles: ["admin", "directeur", "secretaire"],
  deleteRoles: ["admin"],
}));

app.use("/api/schools/:schoolId/staff", createCrudRouter(Staff, {
  readRoles: ["admin", "secretaire"],
  writeRoles: ["admin"],
  deleteRoles: ["admin"],
}));

app.use("/api/schools/:schoolId/finances", createCrudRouter(Finance, {
  readRoles: ["admin", "comptable", "secretaire"],
  writeRoles: ["admin", "comptable", "secretaire"],
  deleteRoles: ["admin"],
}));

app.use("/api/schools/:schoolId/budgets", createCrudRouter(Budget, {
  readRoles: ["admin"],
  writeRoles: ["admin"],
  deleteRoles: ["admin"],
}));

app.use("/api/schools/:schoolId/attendance", createCrudRouter(Attendance, {
  readRoles: ["admin", "directeur", "secretaire", "enseignant"],
  writeRoles: ["admin", "directeur", "enseignant"],
  deleteRoles: ["admin"],
}));

app.use("/api/schools/:schoolId/grades", createCrudRouter(Grade, {
  readRoles: ["admin", "directeur", "enseignant"],
  writeRoles: ["admin", "enseignant"],
  deleteRoles: ["admin"],
}));

app.use("/api/schools/:schoolId/discipline", createCrudRouter(Discipline, {
  readRoles: ["admin", "directeur", "secretaire"],
  writeRoles: ["admin", "directeur"],
  deleteRoles: ["admin"],
}));

app.use("/api/schools/:schoolId/timetable", createCrudRouter(Timetable, {
  readRoles: ["admin", "directeur", "secretaire", "enseignant"],
  writeRoles: ["admin", "directeur"],
  deleteRoles: ["admin"],
}));

app.use("/api/schools/:schoolId/announcements", createCrudRouter(Announcement, {
  readRoles: ["admin", "directeur", "secretaire", "enseignant"],
  writeRoles: ["admin", "directeur", "secretaire"],
  deleteRoles: ["admin"],
}));

// Start
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`ÉcoleOS API running on port ${PORT}`);
  });
});
