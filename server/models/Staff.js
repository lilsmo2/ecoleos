import mongoose from "mongoose";

const staffSchema = new mongoose.Schema({
  _id: String,
  schoolId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  username: { type: String, required: true },
  passHash: String,
  role: { type: String, enum: ["directeur", "secretaire", "enseignant", "comptable"], required: true },
  status: { type: String, enum: ["actif", "inactif"], default: "actif" },
  deletedAt: Date,
}, { timestamps: true });

export default mongoose.model("Staff", staffSchema);
