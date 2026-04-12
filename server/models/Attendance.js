import mongoose from "mongoose";

const attendanceSchema = new mongoose.Schema({
  _id: String,
  schoolId: { type: String, required: true, index: true },
  studentId: { type: String, required: true, index: true },
  date: { type: String, required: true },
  status: { type: String, enum: ["present", "absent", "retard", "excusé"], required: true },
  note: String,
  deletedAt: Date,
}, { timestamps: true });

export default mongoose.model("Attendance", attendanceSchema);
