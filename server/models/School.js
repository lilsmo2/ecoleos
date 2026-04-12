import mongoose from "mongoose";

const schoolSchema = new mongoose.Schema({
  _id: String,
  name: { type: String, required: true },
  city: { type: String, required: true },
  code: { type: String, required: true, unique: true },
  adminUser: { type: String, default: "admin" },
  adminPassHash: String,
  plan: { type: String, enum: ["essai", "basique", "standard", "premium"], default: "essai" },
  subEnd: String,
  subStatus: { type: String, enum: ["actif", "expiré", "suspendu"], default: "actif" },
  // receipt / branding fields
  phone:   String,   // e.g. "+226 78-62-06-57"
  address: String,   // e.g. "TANGHIN / Derrière les rails"
  motto:   String,   // e.g. "DISCIPLINE - ÉVEIL - RÉUSSITE"
  academicYear: String, // e.g. "2025/2026"
}, { timestamps: true });

export default mongoose.model("School", schoolSchema);
