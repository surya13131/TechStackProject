import express from "express";
import multer from "multer";
import { processImages } from "../controllers/uploadController.js";
import { 
  getRecords, 
  updateRecord, 
  deleteRecord // <-- 1. Imported deleteRecord
} from "../controllers/dataController.js";

const router = express.Router();

// Multer Config with File Validation
const upload = multer({
  dest: "uploads/",
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/jpg", "image/png"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPG and PNG files are allowed."));
    }
  },
});

// Handle Multer Errors (e.g., wrong file type) gracefully
const uploadMiddleware = (req, res, next) => {
  const uploadHandler = upload.array("images", 10);
  uploadHandler(req, res, function (err) {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    next();
  });
};

// Routes
router.post("/upload", uploadMiddleware, processImages);
router.get("/records", getRecords);
router.put("/records/:id", updateRecord);
router.delete("/records/:id", deleteRecord); // <-- 2. Added the DELETE route

export default router;