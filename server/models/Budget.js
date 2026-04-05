import mongoose from "mongoose";

const budgetSchema = new mongoose.Schema({
  _id: String,
  schoolId: { type: String, required: true, index: true },
  year: { type: Number, required: true },
  month: String,
  scope: { type: String, enum: ["monthly", "annual", "activity"], default: "monthly" },
  activity: String,
  type: { type: String, enum: ["income", "expense"], required: true },
  category: String,
  planned: { type: Number, required: true },
  note: String,
  deletedAt: Date,
}, { timestamps: true });

export default mongoose.model("Budget", budgetSchema);
