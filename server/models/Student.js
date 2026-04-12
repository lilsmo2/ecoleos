import mongoose from "mongoose";

const studentSchema = new mongoose.Schema({
  _id: String,
  schoolId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  grade: String,
  parent: String,
  status:    { type: String, enum: ["actif", "inactif"], default: "actif" },
  // payment-tracking fields
  nId:       String,   // N° ID shown on receipt (e.g. "75A")
  matricule: String,   // Registration number (e.g. "SV-48")
  tuition:   Number,   // Annual tuition fee (e.g. 95000)
  deletedAt: Date,
}, { timestamps: true });

export default mongoose.model("Student", studentSchema);
