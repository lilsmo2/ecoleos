import mongoose from "mongoose";

const tuitionPaymentSchema = new mongoose.Schema({
  _id: String,
  schoolId:          { type: String, required: true, index: true },
  studentId:         { type: String, required: true, index: true },
  installmentNumber: { type: Number },          // 1, 2, 3 …
  amount:            { type: Number, required: true },
  date:              { type: String },           // "YYYY-MM-DD"
  paymentMethod:     { type: String, default: "Espèce" }, // Espèce | Chèque | Virement | Mobile Money
  receiptNumber:     { type: Number },
  notes:             { type: String, default: "" },
  deletedAt:         Date,
}, { timestamps: true });

export default mongoose.model("TuitionPayment", tuitionPaymentSchema);
