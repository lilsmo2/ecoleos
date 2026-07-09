import mongoose from "mongoose";

// Generic per-school key/value store. Holds any localStorage blob (arrays or
// singleton objects) that doesn't have a dedicated typed collection — e.g.
// classes, exams, incidents, cantine, library, payroll, tuition config,
// seating maps, logos. Keyed by the exact frontend storage key.
const storeSchema = new mongoose.Schema({
  _id: String,                 // e.g. "eos3_cls_<schoolId>"
  schoolId: { type: String, index: true, default: null },
  data: mongoose.Schema.Types.Mixed,
}, { timestamps: true, minimize: false });

export default mongoose.model("Store", storeSchema);
