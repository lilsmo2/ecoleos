import mongoose from "mongoose";

const disciplineSchema = new mongoose.Schema({
  _id: String,
  schoolId: { type: String, required: true, index: true },
  studentId: { type: String, required: true, index: true },
  type: { type: String, enum: ["avertissement", "blâme", "exclusion", "retenue", "autre"], required: true },
  description: { type: String, required: true },
  date: { type: String, required: true },
  sanction: String,
  staff: String,
  deletedAt: Date,
}, { timestamps: true });

export default mongoose.model("Discipline", disciplineSchema);
