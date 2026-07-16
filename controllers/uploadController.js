import mongoose from "mongoose";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import sharp from "sharp"; // Improvement 1: Import sharp
import { createWorker } from "tesseract.js";
import Record from "../models/Record.js";

const fsPromises = fs.promises;

// ==========================================
// 🧠 FINE-TUNED EXTRACTION ENGINE
// ==========================================
const extractDataFromText = (text) => {
  // Improvement 9: Parse by Labels instead of guessing
  const getField = (labelRegex) => {
    const match = text.match(labelRegex);
    return match ? match[1].split("\n")[0].trim() : null;
  };

  // 1. NAME EXTRACTION (Improvement 3 & 9)
  const nameRegex = /(?:Name|Candidate Name|Applicant Name)\s*[:\-]?\s*([A-Za-z ]{3,40})/i;
  let name = getField(nameRegex);

  // 2. EMAIL EXTRACTION
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,8}\b/i;
  const emailMatch = text.match(emailRegex);
  const email = emailMatch ? emailMatch[0].toLowerCase() : "Nil";

  // Name Fallback: If label isn't found, try generating from email
  if (!name && email !== "Nil") {
    const emailPrefix = email.split('@')[0];
    let nameParts = emailPrefix.replace(/[0-9]/g, '').replace(/[._-]/g, ' ').trim();
    
    if (!nameParts.includes(' ')) {
        nameParts = nameParts.replace(/([a-z])([A-Z])/g, '$1 $2');
    }
    if (nameParts.length > 1) {
       name = nameParts.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }
  }

  // 3. PHONE EXTRACTION (Improvement 2)
  let phone = "Nil";
  const phones = text.match(/(?:\+91[\s-]?)?[6-9]\d{9}/g);
  if (phones && phones.length) {
      phone = phones[0].replace("+91", "").trim();
  }

  // 4. COLLEGE EXTRACTION (Improvement 4)
  let college = "Nil";
  const collegeRegex = /([A-Za-z .,&'-]{5,80}(?:College|University|Institute|Academy))/i;
  const collegeMatch = text.match(collegeRegex);
  if (collegeMatch) {
      college = collegeMatch[1].trim();
  }

  // 5. DEPARTMENT EXTRACTION (Improvement 5)
  let department = "Nil";
  const deptRegex = /\b(BE|B\.E|BTECH|B\.TECH|BCA|MCA|MBA|BSC|B\.SC|ME|M\.E|ECE|EEE|CSE|IT|AIDS|AIML)\b/i;
  const deptMatch = text.match(deptRegex);
  if (deptMatch) {
      department = deptMatch[0].toUpperCase().replace(/\./g, '');
  }

  // 6. LOCATION EXTRACTION (Improvement 6)
  let location = "Nil";
  const locRegex = /(?:Location|City|Address)\s*[:\-]?\s*([A-Za-z ]+)/i;
  const locMatch = text.match(locRegex);
  
  if (locMatch) {
      location = locMatch[1].split('\n')[0].trim();
  } else {
      // Fallback: Tech Hub keyword search
      const techHubs = ["chennai", "omr", "sholinganallur", "perungudi", "tidel park", "bangalore", "hyderabad", "pune", "mumbai", "coimbatore"];
      for (const city of techHubs) {
        if (new RegExp(`\\b${city}\\b`, 'i').test(text)) {
          location = city.length <= 3 ? city.toUpperCase() : city.charAt(0).toUpperCase() + city.slice(1);
          break;
        }
      }
  }

  // 7. PLATFORM EXTRACTION
  let platform = "Nil";
  const lowerText = text.toLowerCase();
  if (/\bnaukri\b/i.test(lowerText)) platform = "Naukri";
  else if (/\bshine\b/i.test(lowerText)) platform = "Shine";
  else if (/\blinkedin\b/i.test(lowerText)) platform = "LinkedIn";
  else if (/\bfoundit\b|\bmonster\b/i.test(lowerText)) platform = "Foundit";
  else if (/\bindeed\b/i.test(lowerText)) platform = "Indeed";

  return { 
    name: name || "Nil", 
    email, 
    phone, 
    location, 
    college, 
    department, 
    platform 
  };
};

// ==========================================
// 🚀 MAIN UPLOAD CONTROLLER 
// ==========================================
export const processImages = async (req, res) => {
  try {
    const files = req.files;
    if (!files || files.length === 0) return res.status(400).json({ error: "No files uploaded." });

    const results = [];
    const duplicates = [];
    const worker = await createWorker('eng');

    try {
      for (const file of files) {
        const startTime = Date.now();
        const originalPath = path.resolve(file.path);

        try {
          const fileBuffer = await fsPromises.readFile(originalPath);
          const hash = crypto.createHash("sha256").update(fileBuffer).digest("hex");

          // Duplicate check
          const existingRecord = await Record.findOne({ imageHash: hash }).lean();
          if (existingRecord) {
            duplicates.push(file.originalname);
            await fsPromises.unlink(originalPath).catch(() => {});
            continue; 
          }

          // Improvement 1: Preprocess with Sharp before OCR
          const processedImageBuffer = await sharp(fileBuffer)
            .grayscale()
            .normalize()
            .sharpen()
            .threshold(160)
            .toBuffer();

          // Improvement 8: Extract data and confidence
          const { data } = await worker.recognize(processedImageBuffer);
          
          console.log(`\n--- OCR Results for ${file.originalname} ---`);
          console.log(`Confidence Score: ${data.confidence}`); // E.g., Confidence = 97
          
          // Improvement 7: Print OCR Text to see exactly what Tesseract is reading
          console.log(`Extracted Text:\n${data.text}`);
          console.log(`-----------------------------------------\n`);

          let extractedData = extractDataFromText(data.text);
          
          // Fallback to filename if name is missing/corrupted
          if (!extractedData.name || extractedData.name === "Nil" || /^\d+$/.test(extractedData.name.replace(/\s/g, ''))) {
             let potentialName = file.originalname.split('.')[0].replace(/[_-]/g, ' ').trim();
             extractedData.name = /^\d+$/.test(potentialName.replace(/\s/g, '')) ? "Nil" : potentialName;
          }

          const loadingTime = ((Date.now() - startTime) / 1000).toFixed(2) + " sec";
          const newRecord = await Record.create({ imageHash: hash, ...extractedData, loadingTime });

          results.push(newRecord);
        } catch (err) {
          console.error(`Error processing ${file.originalname}:`, err);
        } finally {
          await fsPromises.unlink(originalPath).catch(() => {});
        }
      }
    } finally {
      await worker.terminate();
    }

    res.status(200).json({ processed: results, duplicates });
  } catch (err) {
    res.status(500).json({ error: "Server Error." });
  }
};

// ==========================================
// Fetch, Update, Delete Controllers (Unchanged)
// ==========================================
export const getRecords = async (req, res) => { /* ... existing code ... */ };
export const updateRecord = async (req, res) => { /* ... existing code ... */ };
export const deleteRecord = async (req, res) => { /* ... existing code ... */ };