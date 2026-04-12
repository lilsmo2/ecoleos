import mongoose from "mongoose";

const timetableSchema = new mongoose.Schema({
  _id: String,
  schoolId: { type: String, required: true, index: true },
  classId: { type: String, index: true },
  day: { type: String, enum: ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"], required: true },
  startTime: { type: String, required: true },
  endTime: { type: String, required: true },
  subject: { type: String, required: true },
  teacher: String,
  room: String,
  deletedAt: Date,
}, { timestamps: true });

export default mongoose.model("Timetable", timetableSchema);
