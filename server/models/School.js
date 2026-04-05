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
}, { timestamps: true });

export default mongoose.model("School", schoolSchema);
