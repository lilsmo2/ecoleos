import "dotenv/config";
import express from "express";
import cors from "cors";
import { connectDB } from "./config/db.js";

import authRoutes from "./routes/auth.js";
import schoolRoutes from "./routes/schools.js";
import syncRoutes from "./routes/sync.js";
import { createCrudRouter } from "./routes/crud.js";

import Student from "./models/Student.js";
import Staff from "./models/Staff.js";
import Finance from "./models/Finance.js";
import Budget from "./models/Budget.js";

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

// Start
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`ÉcoleOS API running on port ${PORT}`);
  });
});
