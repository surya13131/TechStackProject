import crypto from "crypto";
import fs from "fs";
import path from "path";
import { createWorker } from "tesseract.js";
import Record from "../models/Record.js";

const fsPromises = fs.promises;

// ==========================================
// 🧠 FORMAT-MATCHING EXTRACTION ENGINE
// ==========================================
const extractDataFromText = (text) => {
  let name = "Nil";
  let email = "Nil";
  let phone = "Nil";
  let location = "Nil";
  let college = "Nil";
  let department = "Nil";
  let platform = "Nil";

  // Normalize spaces and remove weird OCR symbols
  const cleanedText = text.replace(/[\u200B-\u200D\uFEFF|~*^_{}[\]\\]/g, ' ').replace(/\s+/g, ' ').trim();
  const lowerText = cleanedText.toLowerCase();
  
  // Array of text lines
  const lines = cleanedText.split("\n").map(line => line.trim()).filter(line => line.length > 2);

  // ---------------------------------------------------------
  // 1. EXACT FORMAT MATCHING (Phone, Email, Platform)
  // ---------------------------------------------------------
  
  // Phone: Matches any 10-digit number starting with 6-9, ignoring spaces/dashes
  const phoneRegex = /(?:(?:\+|0{0,2})91[\s-]?)?([6-9]\d{2}[\s-]?\d{3}[\s-]?\d{4})/;
  const phoneMatch = cleanedText.match(phoneRegex);
  if (phoneMatch) phone = phoneMatch[1].replace(/[\s-]/g, ''); 

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

  const deptKeywords = [
    "computer science", "information technology", "electronics", "electrical",
    "mechanical", "civil", "data science", "artificial intelligence",
    "cse", "ece", "eee", "mech", "it"
  ];
  
  // Look for the line containing the department to extract the whole format (e.g., "B.Tech in CSE")
  const deptLine = lines.find(line => deptKeywords.some(kw => new RegExp(`\\b${kw.replace(/\./g, '\\.')}\\b`, 'i').test(line)));
  if (deptLine) {
    department = deptLine.replace(/department|branch|course|stream|[:\-]/gi, "").trim();
    // Keep it concise
    if (department.length > 40) department = department.substring(0, 40) + "...";
  }

  // ---------------------------------------------------------
  // 3. NAME & COLLEGE: PATTERN RECOGNITION 
  // ---------------------------------------------------------
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // College Pattern: Looks for lines with university/college formats
    if (college === "Nil" && /(university|institute|college|academy|polytechnic|b\.?tech|b\.?e|m\.?ca)/i.test(line)) {
      // Don't grab generic UI headers
      if (!/(education|highest degree|qualification)/i.test(line) || line.length > 15) {
         college = line.replace(/highest degree|education|qualification|[:\-]/gi, "").trim();
      }
    }
    
    // Name Pattern (No restrictive blocklists):
    // If we haven't found a name yet, look at the first 5 lines.
    // We are looking for Title Case formats (e.g., "John Doe", "Surya V") 
    // or pure uppercase names (e.g., "SURYA V"). It must not have numbers or symbols.
    if (name === "Nil" && i < 5) {
      // Match Title Case (First letter capital, rest lowercase) OR all caps
      const isNameFormat = /^([A-Z][a-z]+(\s+[A-Z][a-z]+)*|[A-Z\s]+)$/.test(line);
      const isNotEmailOrURL = !line.includes("@") && !line.includes("www");
      
      // If it looks like a formatted name and is a reasonable length
      if (isNameFormat && isNotEmailOrURL && line.length > 2 && line.length < 30) {
        // Exclude obvious UI words if they are the ONLY word on the line
        const uiWords = ["resume", "home", "search", "menu", "profile", "contact"];
        if (!uiWords.includes(line.toLowerCase())) {
           name = line;
        }
      }
    }
  }

  // ---------------------------------------------------------
  // 4. INFERENCE FALLBACKS
  // ---------------------------------------------------------
  
  // If Name is STILL Nil, try to guess it from the email prefix!
  // E.g., surya.v@gmail.com -> "Surya V"
  if (name === "Nil" && email !== "Nil") {
    const emailPrefix = email.split('@')[0];
    // Remove numbers and replace dots/underscores with spaces, then capitalize
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
          
          // ONLY use filename as an absolute last resort if even email inference failed
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