import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";


dotenv.config();


console.log("🔑 Gemini API Key Status:", process.env.GEMINI_API_KEY ? "LOADED" : "MISSING!");

import apiRoutes from "./routes/apiRoutes.js";

const app = express();


app.use(cors({
  origin: "https://techsatkc-ui.vercel.app"
}));
app.use(express.json());


app.use("/api", apiRoutes);


app.get("/", (req, res) => {
  res.send("🚀 Backend is Running!");
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, "uploads");

const cleanUploadsDirectory = () => {
  if (fs.existsSync(uploadsDir)) {
    fs.readdir(uploadsDir, (err, files) => {
      if (err) {
        return console.error("Error reading uploads directory:", err);
      }
      let count = 0;
      for (const file of files) {
    
        if (file !== ".gitkeep") {
          fs.unlink(path.join(uploadsDir, file), (err) => {
            if (err) console.error("Error deleting orphaned file:", err);
          });
          count++;
        }
      }
      if (count > 0) {
        console.log(`🧹 Cleaned up ${count} orphaned temporary files in /uploads`);
      }
    });
  } else {

    fs.mkdirSync(uploadsDir);
    console.log("📁 Created /uploads directory");
  }
};


const PORT = process.env.PORT || 5000;

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("✅ Connected to MongoDB Atlas");
    

    cleanUploadsDirectory();

    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ MongoDB Connection Error:", err.message);
    process.exit(1);
  });