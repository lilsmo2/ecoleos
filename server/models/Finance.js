import mongoose from "mongoose";

const financeSchema = new mongoose.Schema({
  _id: String,
  schoolId: { type: String, required: true, index: true },
  type: { type: String, enum: ["income", "expense"], required: true },
  category: String,
  label: { type: String, required: true },
  amount: { type: Number, required: true },
  date: String,
  note: String,
  deletedAt: Date,
}, { timestamps: true });

export default mongoose.model("Finance", financeSchema);
