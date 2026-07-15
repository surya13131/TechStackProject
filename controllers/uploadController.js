import crypto from "crypto";
import fs from "fs";
import path from "path";
import { createWorker } from "tesseract.js";
import Record from "../models/Record.js";

const fsPromises = fs.promises;

// ==========================================
// 🧠 ADVANCED EXTRACTION ENGINE (FIXED SPLITTER)
// ==========================================
const extractDataFromText = (text) => {
  let name = "Nil";
  let email = "Nil";
  let phone = "Nil";
  let location = "Nil";
  let college = "Nil";
  let department = "Nil";
  let platform = "Nil";

  const cleanedText = text.replace(/[\u200B-\u200D\uFEFF|~*^_{}[\]\\]/g, ' ').replace(/\s+/g, ' ').trim();
  const lowerText = cleanedText.toLowerCase();
  const lines = cleanedText.split("\n").map(line => line.trim()).filter(line => line.length > 2);

  // 1. Phone
  const phoneRegex = /(?<!\d)(?:\+?91[\s-]?)?([6-9]\d{9})\b/;
  const phoneMatch = cleanedText.match(phoneRegex);
  if (phoneMatch) phone = phoneMatch[1]; 

  // 2. Email
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,8}\b/;
  const emailMatch = cleanedText.match(emailRegex);
  if (emailMatch) email = emailMatch[0].toLowerCase();

  // 3. Platform
  if (/\bnaukri\b/i.test(lowerText)) platform = "Naukri";
  else if (/\bshine\b/i.test(lowerText)) platform = "Shine";
  else if (/\blinkedin\b/i.test(lowerText)) platform = "LinkedIn";
  else if (/\bfoundit\b|\bmonster\b/i.test(lowerText)) platform = "Foundit";
  else if (/\bindeed\b/i.test(lowerText)) platform = "Indeed";

  // 4. Location
  const techHubs = ["chennai", "omr", "sholinganallur", "perungudi", "bangalore", "bengaluru", "hyderabad", "pune", "mumbai", "delhi", "noida", "gurugram", "gurgaon", "coimbatore"];
  for (const city of techHubs) {
    if (new RegExp(`\\b${city}\\b`, 'i').test(cleanedText)) {
      location = city.length <= 3 ? city.toUpperCase() : city.charAt(0).toUpperCase() + city.slice(1);
      break;
    }
  }

  // 5. DEPARTMENT/COLLEGE SPLITTER (The fix)
  // Look for education lines. If a line starts with a degree, split it.
  const degreePattern = /(B\.?C\.?A|B\.?Sc|B\.?Tech|B\.?E|M\.?C\.?A|M\.?B\.?A|M\.?Sc|B\.?A|B\.?Com)/i;
  
  for (const line of lines) {
    // Check if the line looks like an education entry
    if (/(university|college|institute|academy|polytechnic|b\.?tech|b\.?sc|b\.?c\.?a)/i.test(line)) {
      const match = line.match(degreePattern);
      
      if (match) {
        // We found a degree at the start!
        department = match[0].toUpperCase().replace(/\./g, ''); // e.g., "B.C.A." -> "BCA"
        college = line.replace(match[0], "").replace(/highest degree|education|qualification|[:\-]/gi, "").trim();
      } else {
        // No specific degree found at start, just extract the whole thing as college
        college = line.replace(/highest degree|education|qualification|[:\-]/gi, "").trim();
      }
      break; // Stop after finding the education line
    }
  }

  // 6. Fallback: If department still Nil, check keyword list
  if (department === "Nil") {
    const deptKeywords = ["CSE", "IT", "ECE", "EEE", "MECH", "CIVIL", "MCA", "BCA", "MBA"];
    for (const d of deptKeywords) {
      if (lowerText.includes(d.toLowerCase())) {
        department = d;
        break;
      }
    }
  }

  // 7. Name Inference
  if (email !== "Nil") {
    const emailPrefix = email.split('@')[0];
    const cleanedPrefix = emailPrefix.replace(/[0-9]/g, '').replace(/[._-]/g, ' ').trim();
    if (cleanedPrefix.length > 2) {
      name = cleanedPrefix.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }
  }

  return { 
    name: name || "Nil", 
    email, 
    phone, 
    location, 
    college: college || "Nil", 
    department: department || "Nil", 
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

          const existingRecord = await Record.findOne({ imageHash: hash }).lean();
          if (existingRecord) {
            duplicates.push(file.originalname);
            await fsPromises.unlink(originalPath).catch(() => {});
            continue; 
          }

          const { data: { text } } = await worker.recognize(originalPath);
          let extractedData = extractDataFromText(text);
          
          if (extractedData.name === "Nil") extractedData.name = file.originalname.split('.')[0]; 

          const loadingTime = ((Date.now() - startTime) / 1000).toFixed(2) + " sec";
          const newRecord = await Record.create({ imageHash: hash, ...extractedData, loadingTime });

          results.push(newRecord);
        } catch (err) {
          console.error(`Error: ${file.originalname}`, err);
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