import crypto from "crypto";
import fs from "fs";
import path from "path";
import { createWorker } from "tesseract.js";
import Record from "../models/Record.js";

const fsPromises = fs.promises;

// ==========================================
// 🧠 TARGETED SUBSTRING EXTRACTION ENGINE
// ==========================================
const extractDataFromText = (text) => {
  let name = "Nil";
  let email = "Nil";
  let phone = "Nil";
  let location = "Nil";
  let college = "Nil";
  let department = "Nil";
  let platform = "Nil";

  // 1. Clean the text and remove URL artifacts that confuse the parser
  const cleanedText = text
    .replace(/[\u200B-\u200D\uFEFF|~*^_{}[\]\\]/g, ' ') // Remove artifacts
    .replace(/https?:\/\/[^\s]+/g, '') // Strip URLs completely so they don't trigger false phone/email hits
    .replace(/\s+/g, ' ') // Normalize spaces
    .trim();
    
  const lowerText = cleanedText.toLowerCase();

  // ---------------------------------------------------------
  // 1. EXACT FORMAT MATCHING (Phone, Email, Platform)
  // ---------------------------------------------------------
  
  // Phone: Strict word boundaries \b to prevent catching random IDs. 
  // Looks for 10 digits starting with 6-9, optionally preceded by +91 or 0.
  const phoneRegex = /\b(?:\+?91[\s-]?)?([6-9]\d{9})\b/;
  const phoneMatch = cleanedText.match(phoneRegex);
  if (phoneMatch) phone = phoneMatch[1]; 

  // Email: Standard structure
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,8}\b/;
  const emailMatch = cleanedText.match(emailRegex);
  if (emailMatch) email = emailMatch[0].toLowerCase();

  // Platform: Word boundary matches
  if (/\bnaukri\b/i.test(lowerText)) platform = "Naukri";
  else if (/\bshine\b/i.test(lowerText)) platform = "Shine";
  else if (/\blinkedin\b/i.test(lowerText)) platform = "LinkedIn";
  else if (/\bfoundit\b|\bmonster\b/i.test(lowerText)) platform = "Foundit";
  else if (/\bindeed\b/i.test(lowerText)) platform = "Indeed";

  // ---------------------------------------------------------
  // 2. DICTIONARY MATCHING (Location & Dept)
  // ---------------------------------------------------------
  
  const techHubs = [
    "chennai", "omr", "sholinganallur", "perungudi", "tidel park", 
    "bangalore", "bengaluru", "hyderabad", "pune", "mumbai", 
    "delhi", "noida", "gurugram", "gurgaon", "coimbatore", "kochi"
  ];
  for (const city of techHubs) {
    if (new RegExp(`\\b${city}\\b`, 'i').test(cleanedText)) {
      location = city.length <= 3 ? city.toUpperCase() : city.charAt(0).toUpperCase() + city.slice(1);
      break;
    }
  }

  // Department: Target exact phrase matches anywhere in the blob
  const deptRegex = /\b(Computer Science|Information Technology|Electronics|Electrical|Mechanical|Civil|Data Science|Artificial Intelligence|B\.?Tech in CSE|B\.?Tech in IT|CSE|ECE|EEE|MECH|IT)\b/i;
  const deptMatch = cleanedText.match(deptRegex);
  if (deptMatch) {
    const rawDept = deptMatch[1].toUpperCase();
    // Normalize common abbreviations
    if (rawDept.includes("COMPUTER SCIENCE") || rawDept === "CSE") department = "CSE";
    else if (rawDept.includes("INFORMATION TECH") || rawDept === "IT") department = "IT";
    else if (rawDept.includes("ELECTRONICS") || rawDept === "ECE") department = "ECE";
    else if (rawDept.includes("ELECTRICAL") || rawDept === "EEE") department = "EEE";
    else if (rawDept.includes("MECHANICAL") || rawDept === "MECH") department = "Mechanical";
    else department = rawDept;
  }

  // ---------------------------------------------------------
  // 3. TARGETED COLLEGE EXTRACTION (Fixes the giant blob issue)
  // ---------------------------------------------------------
  
  // Hunts for the word College/University and extracts only the 30 characters before and 20 characters after it.
  const collegeRegex = /([A-Za-z\s&.,-]{5,40}(?:College|University|Institute|Academy|Polytechnic)[A-Za-z\s&.,-]{0,20})/i;
  const collegeMatch = cleanedText.match(collegeRegex);
  
  if (collegeMatch) {
    // Clean up the extracted phrase
    let extractedCollege = collegeMatch[1]
      .replace(/highest degree|education|qualification|passed out|graduated/gi, "")
      .replace(/^[,\s\-]+|[,\s\-]+$/g, "") // Remove trailing/leading commas or spaces
      .trim();
      
    // Enforce an absolute maximum length so it never breaks the UI table again
    college = extractedCollege.length > 50 ? extractedCollege.substring(0, 50) + "..." : extractedCollege;
  }

  // ---------------------------------------------------------
  // 4. INFERENCE FALLBACKS (Name)
  // ---------------------------------------------------------
  
  // Name extraction from email (Most reliable non-AI method for resumes)
  if (email !== "Nil") {
    const emailPrefix = email.split('@')[0];
    const cleanedPrefix = emailPrefix.replace(/[0-9]/g, '').replace(/[._-]/g, ' ').trim();
    if (cleanedPrefix.length > 2) {
      name = cleanedPrefix.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }
  }

  // Final cleanup bounds
  if (!name || name.trim() === "") name = "Nil";
  if (!college || college.trim() === "") college = "Nil";
  if (!department || department.trim() === "") department = "Nil";

  return { name, email, phone, location, college, department, platform };
};

// ==========================================
// 🚀 MAIN UPLOAD CONTROLLER 
// ==========================================
export const processImages = async (req, res) => {
  try {
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: "No files uploaded." });
    }

    const results = [];
    const duplicates = [];

    console.log("⚙️ Booting up Tesseract OCR Engine...");
    const worker = await createWorker('eng');

    try {
      for (const file of files) {
        const startTime = Date.now();
        const originalPath = path.resolve(file.path);

        try {
          const fileBuffer = await fsPromises.readFile(originalPath);
          const hash = crypto.createHash("sha256").update(fileBuffer).digest("hex");

          // Duplicate Check
          const existingRecord = await Record.findOne({ imageHash: hash }).lean();
          if (existingRecord) {
            console.log(`⏭️ Skipping duplicate: ${file.originalname}`);
            duplicates.push(file.originalname);
            await fsPromises.unlink(originalPath).catch(() => {});
            continue; 
          }

          // Run OCR
          console.log(`📄 Reading ${file.originalname}...`);
          const { data: { text } } = await worker.recognize(originalPath);
          
          // Extract Structured Data
          let extractedData = extractDataFromText(text);
          
          // Absolute Last Resort for Name
          if (extractedData.name === "Nil") {
              extractedData.name = file.originalname.split('.')[0]; 
          }

          const loadingTime = ((Date.now() - startTime) / 1000).toFixed(2) + " sec";

          // Save to Database
          const newRecord = await Record.create({
            imageHash: hash,
            ...extractedData,
            loadingTime,
          });

          results.push(newRecord);
          console.log(`✅ Successfully saved data for ${file.originalname}`);

        } catch (fileError) {
          console.error(`❌ Error processing file ${file.originalname}:`, fileError);
        } finally {
          await fsPromises.unlink(originalPath).catch(() => {});
        }
      }
    } finally {
      console.log("🛑 Shutting down Tesseract OCR Engine...");
      await worker.terminate();
    }

    res.status(200).json({ 
      message: `Processed ${results.length} files, ${duplicates.length} duplicates skipped.`,
      processed: results, 
      duplicates 
    });

  } catch (err) {
    console.error("Upload Route Error:", err);
    res.status(500).json({ error: "Server Error during batch processing." });
  }
};