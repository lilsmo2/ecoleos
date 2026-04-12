import mongoose from "mongoose";

const announcementSchema = new mongoose.Schema({
  _id: String,
  schoolId: { type: String, required: true, index: true },
  title: { type: String, required: true },
  body: { type: String, required: true },
  audience: { type: String, enum: ["all", "parents", "staff", "students"], default: "all" },
  date: String,
  deletedAt: Date,
}, { timestamps: true });

export default mongoose.model("Announcement", announcementSchema);
