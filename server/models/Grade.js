import mongoose from "mongoose";

const gradeSchema = new mongoose.Schema({
  _id: String,
  schoolId: { type: String, required: true, index: true },
  studentId: { type: String, required: true, index: true },
  subject: { type: String, required: true },
  exam: String,
  score: { type: Number, required: true },
  total: { type: Number, default: 20 },
  date: String,
  term: String,
  note: String,
  deletedAt: Date,
}, { timestamps: true });

export default mongoose.model("Grade", gradeSchema);
