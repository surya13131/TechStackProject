import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// 1. MUST BE AT THE VERY TOP
dotenv.config();

// 2. GEMINI KEY CHECK
console.log("🔑 Gemini API Key Status:", process.env.GEMINI_API_KEY ? "LOADED" : "MISSING!");

import apiRoutes from "./routes/apiRoutes.js";

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// API Routes
app.use("/api", apiRoutes);

// Test Route
app.get("/", (req, res) => {
  res.send("🚀 Backend is Running!");
});

// ==========================================
// ORPHANED FILE CLEANUP SCRIPT
// ==========================================
// (Polyfill for __dirname in ES Modules)
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
        // Skip hidden files like .gitkeep if you have them
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
    // If the folder doesn't exist, create it so Multer doesn't crash on the first upload
    fs.mkdirSync(uploadsDir);
    console.log("📁 Created /uploads directory");
  }
};
// ==========================================

const PORT = process.env.PORT || 5000;

// Connect to MongoDB Atlas FIRST, then start the server
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("✅ Connected to MongoDB Atlas");
    
    // Run the cleanup script right after the DB connects
    cleanUploadsDirectory();
    
    // Start Server ONLY after a successful database connection
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ MongoDB Connection Error:", err.message);
    process.exit(1);
  });