import crypto from "crypto";
import fs from "fs";
import path from "path";
import { createWorker } from "tesseract.js";
import Record from "../models/Record.js";

const fsPromises = fs.promises;

// ==========================================
// 🧠 MAX-ACCURACY DATA EXTRACTION ENGINE
// ==========================================
const extractDataFromText = (text) => {
  let name = "Nil";
  let email = "Nil";
  let phone = "Nil";
  let location = "Nil";
  let college = "Nil";
  let department = "Nil";
  let platform = "Nil";

  // 1. Aggressive Text Cleaning (Fixes Tesseract's visual noise)
  const cleanedText = text
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width spaces
    .replace(/[|~*^_{}[\]\\]/g, ' ')       // Strip common OCR artifact characters
    .replace(/\s+/g, ' ')                  // Normalize spacing
    .trim();
    
  const lowerText = cleanedText.toLowerCase();
  
  // Split into clean, non-empty lines
  const lines = text.split("\n").map(line => line.replace(/[|~*^]/g, '').trim()).filter(line => line.length > 2);

  // ---------------------------------------------------------
  // 1. EXACT PATTERN MATCHING
  // ---------------------------------------------------------
  
  // Phone: Indian format (catches +91, 0, or just 10 digits starting with 6-9)
  const phoneRegex = /(?:(?:\+|0{0,2})91[\s-]?)?([6-9]\d{2}[\s-]?\d{3}[\s-]?\d{4})/;
  const phoneMatch = cleanedText.match(phoneRegex);
  if (phoneMatch) phone = phoneMatch[1].replace(/[\s-]/g, ''); // Strip spaces/dashes from output

  // Email: Stricter regex to avoid picking up file extensions (like image.png)
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,6}\b/;
  const emailMatch = cleanedText.match(emailRegex);
  if (emailMatch) email = emailMatch[0].toLowerCase();

  // Platform: Word boundaries prevent partial matches
  if (/\bnaukri\b/.test(lowerText)) platform = "Naukri";
  else if (/\bshine\b/.test(lowerText)) platform = "Shine";
  else if (/\blinkedin\b/.test(lowerText)) platform = "LinkedIn";
  else if (/\bfoundit\b|\bmonster\b/.test(lowerText)) platform = "Foundit";
  else if (/\bindeed\b/.test(lowerText)) platform = "Indeed";

  // ---------------------------------------------------------
  // 2. DICTIONARY MATCHING (Location & Dept)
  // ---------------------------------------------------------
  
  const techHubs = [
    "chennai", "omr", "sholinganallur", "perungudi", "tidel park", 
    "bangalore", "bengaluru", "hyderabad", "pune", "mumbai", 
    "delhi", "noida", "gurugram", "gurgaon", "coimbatore", "kochi"
  ];
  for (const city of techHubs) {
    if (new RegExp(`\\b${city}\\b`).test(lowerText)) {
      // Format nicely (e.g., "Omr" -> "OMR", "Chennai" -> "Chennai")
      location = city.length <= 3 ? city.toUpperCase() : city.charAt(0).toUpperCase() + city.slice(1);
      break;
    }
  }

  const deptKeywords = [
    "computer science", "information technology", "electronics", "electrical",
    "mechanical", "civil", "data science", "artificial intelligence",
    "b.tech in it", "b.tech in cse", "cse", "ece", "eee", "mech"
  ];
  const foundDept = deptKeywords.find(kw => new RegExp(`\\b${kw.replace(/\./g, '\\.')}\\b`).test(lowerText));
  if (foundDept) {
    department = foundDept.toUpperCase() === foundDept 
      ? foundDept.toUpperCase() 
      : foundDept.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  // ---------------------------------------------------------
  // 3. HEURISTIC LINE SCANNING
  // ---------------------------------------------------------
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lowerLine = line.toLowerCase();

    // A. Explicit Label Checks
    if (name === "Nil" && lowerLine.match(/^(name|candidate name)[\s:-]+/)) {
      name = line.replace(/^(name|candidate name)[\s:-]+/i, "").trim();
    }
    if (college === "Nil" && lowerLine.match(/^(college|institute|university)[\s:-]+/)) {
      college = line.replace(/^(college|institute|university)[\s:-]+/i, "").trim();
    }
    if (department === "Nil" && lowerLine.match(/^(department|branch|course|stream|specialization)[\s:-]+/)) {
      department = line.replace(/^(department|branch|course|stream|specialization)[\s:-]+/i, "").trim();
    }
  }

  // B. Fallback: Name Detection (Top-down scan excluding common resume keywords)
  if (name === "Nil") {
    const invalidNameWords = [
      "resume", "cv", "curriculum", "profile", "page", "contact", 
      "email", "phone", "mobile", "dob", "date", "gender", "status",
      "nationality", "summary", "objective", "skills", "education"
    ];
    
    // Check only the first 5 lines
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      const l = lines[i];
      const lowerL = l.toLowerCase();
      
      // Look for a line with 1-3 words, only letters/dots, no numbers, not in the blocklist
      if (/^[A-Za-z\s\.]{3,35}$/.test(l) && !invalidNameWords.some(word => lowerL.includes(word))) {
        name = l;
        break;
      }
    }
  }

  // C. Fallback: College/Education Detection
  if (college === "Nil") {
    const eduKeywords = ["university", "institute of", "college of", "polytechnic", "academy"];
    const eduLine = lines.find(line => eduKeywords.some(kw => line.toLowerCase().includes(kw)));
    
    if (eduLine) {
      college = eduLine.replace(/highest degree|education|passed out|graduated/gi, "").trim();
    }
  }

  // ---------------------------------------------------------
  // 4. FINAL CLEANUP
  // ---------------------------------------------------------
  
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
          
          // Absolute Safety Fallback: Use filename if name logic fails completely
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