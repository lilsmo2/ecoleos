import mongoose from "mongoose";

const parentAccessSchema = new mongoose.Schema({
  _id: String,
  schoolId: { type: String, required: true, index: true },
  studentId: { type: String, required: true },
  parentName: { type: String, required: true },
  parentPhone: { type: String, required: true, index: true },
  accessCode: { type: String, required: true },
  status: { type: String, enum: ["actif", "inactif"], default: "actif" },
}, { timestamps: true });

export default mongoose.model("ParentAccess", parentAccessSchema);
