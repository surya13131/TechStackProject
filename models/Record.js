import mongoose from "mongoose";

const RecordSchema = new mongoose.Schema({
  imageHash: { type: String, required: true, unique: true },
  name: { type: String, default: "Nil" },
  email: { type: String, default: "Nil" },
  phone: { type: String, default: "Nil" },
  location: { type: String, default: "Nil" },
  college: { type: String, default: "Nil" },
  department: { type: String, default: "Nil" },
  platform: { type: String, default: "Nil" },
  loadingTime: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const Record = mongoose.model("Record", RecordSchema);

export default Record;