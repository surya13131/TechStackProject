import crypto from "crypto";
import fs from "fs";
import path from "path";
import { createWorker } from "tesseract.js";
import Record from "../models/Record.js";

const fsPromises = fs.promises;

// ==========================================
// MAIN UPLOAD CONTROLLER 
// ==========================================
export const processImages = async (req, res) => {
  try {
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: "No files uploaded." });
    }

    const results = [];
    const duplicates = [];

    for (const file of files) {
      const startTime = Date.now();
      const originalPath = path.resolve(file.path);

      try {
        const fileBuffer = await fsPromises.readFile(originalPath);
        const hash = crypto.createHash("sha256").update(fileBuffer).digest("hex");

        // 1. Duplicate Check
        const existingRecord = await Record.findOne({ imageHash: hash }).lean();
        if (existingRecord) {
          duplicates.push(file.originalname);
          await fsPromises.unlink(originalPath).catch(() => {});
          continue; 
        }

        // 2. Perform OCR using tesseract.js
        let ocrText = "";
        const worker = await createWorker('eng');
        try {
          console.log(`🤖 Performing OCR on ${file.originalname} using Tesseract.js...`);
          const { data: { text } } = await worker.recognize(originalPath);
          ocrText = text;
          console.log(`✅ Tesseract.js extracted ${ocrText.length} characters.`);
        } catch (tesseractError) {
          console.error("❌ Tesseract.js OCR failed:", tesseractError);
          ocrText = "OCR Failed.";
        } finally {
          await worker.terminate();
        }

        // Since we are only using Tesseract, we will save the raw text.
        // The previous logic for extracting specific fields with Gemini is removed.
        const extractedFields = {
          name: file.originalname, // Using filename as a placeholder for name
          email: "Nil",
          phone: "Nil",
          location: "Nil",
          college: ocrText, // Storing the full OCR text in the 'college' field for now
          department: "Nil",
          platform: "Nil",
        };

        // 4. Strict Regex Validation
        const phoneRegex = /(?:(?:\+|0{0,2})91[\s-]?)?([6-9]\d{9})/;
        const phoneMatch = (extractedFields.phone || "").match(phoneRegex);
        extractedFields.phone = phoneMatch ? phoneMatch[1] : "Nil";

        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[A-Za-z]{2,}/;
        const emailMatch = (extractedFields.email || "").match(emailRegex);
        extractedFields.email = emailMatch ? emailMatch[0].toLowerCase() : "Nil";

        extractedFields.college = (extractedFields.college || "Nil")
            .replace(/Highest\s*Degree/gi, "")
            .replace(/Education/gi, "")
            .replace(/B\.?Tech|B\.?E|BCA|MCA|MBA|B\.?Sc|M\.?Sc/gi, "")
            .replace(/\s+/g, " ")
            .trim();
        if (!extractedFields.college) extractedFields.college = "Nil";

        const loadingTime = ((Date.now() - startTime) / 1000).toFixed(2) + " sec";

        // 5. Save Record to Database
        const newRecord = await Record.create({
          imageHash: hash,
          ...extractedFields,
          loadingTime,
        });

        results.push(newRecord);

      } catch (fileError) {
        console.error(`❌ File processing error for ${file.originalname}:`, fileError);
      } finally {
        // 6. Clean up Node's local disk
        await fsPromises.unlink(originalPath).catch(() => {});
      }
    }

    res.status(200).json({ processed: results, duplicates });
  } catch (err) {
    console.error("Upload Error:", err);
    res.status(500).json({ error: "Server Error during processing." });
  }
};