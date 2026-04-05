import mongoose from "mongoose";

const studentSchema = new mongoose.Schema({
  _id: String,
  schoolId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  grade: String,
  parent: String,
  status: { type: String, enum: ["actif", "inactif"], default: "actif" },
  deletedAt: Date,
}, { timestamps: true });

export default mongoose.model("Student", studentSchema);
