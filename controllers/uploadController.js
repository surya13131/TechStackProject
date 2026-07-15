import crypto from "crypto";
import fs from "fs";
import path from "path";
import { createWorker } from "tesseract.js";
import Record from "../models/Record.js";

const fsPromises = fs.promises;

// ==========================================
// 🧠 DATA EXTRACTION ENGINE
// ==========================================
const extractDataFromText = (text) => {
  let name = "Nil";
  let email = "Nil";
  let phone = "Nil";
  let location = "Nil";
  let college = "Nil";
  let department = "Nil";
  let platform = "Nil";

  const lowerText = text.toLowerCase();

  // 1. Extract Phone Number (Indian format)
  const phoneRegex = /(?:(?:\+|0{0,2})91[\s-]?)?([6-9]\d{9})/;
  const phoneMatch = text.match(phoneRegex);
  if (phoneMatch) phone = phoneMatch[1];

  // 2. Extract Email Address
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[A-Za-z]{2,}/;
  const emailMatch = text.match(emailRegex);
  if (emailMatch) email = emailMatch[0].toLowerCase();

  // 3. Detect Platform
  if (lowerText.includes("naukri")) platform = "Naukri";
  else if (lowerText.includes("shine")) platform = "Shine";
  else if (lowerText.includes("linkedin")) platform = "LinkedIn";
  else if (lowerText.includes("foundit") || lowerText.includes("monster")) platform = "Foundit";
  else if (lowerText.includes("indeed")) platform = "Indeed";

  // 4. Detect Location (Expanded Indian Tech Hubs)
  const techHubs = [
    "chennai", "bangalore", "bengaluru", "hyderabad", "pune", 
    "mumbai", "delhi", "noida", "gurugram", "gurgaon", "coimbatore",
    "kochi", "trivandrum", "kolkata", "ahmedabad"
  ];
  for (const city of techHubs) {
    if (lowerText.includes(city)) {
      location = city.charAt(0).toUpperCase() + city.slice(1);
      break;
    }
  }

  // 5. Line-by-Line Label Search
  const lines = text.split("\n").map(line => line.trim()).filter(line => line.length > 0);
  
  for (const line of lines) {
    const lowerLine = line.toLowerCase();
    
    if (/(name|candidate):/i.test(lowerLine)) {
      name = line.replace(/(name|candidate):/i, "").trim();
    } else if (/(college|institute|university):/i.test(lowerLine)) {
      college = line.replace(/(college|institute|university):/i, "").trim();
    } else if (/(department|degree|course):/i.test(lowerLine)) {
      department = line.replace(/(department|degree|course):/i, "").trim();
    }
  }

  // 6. Smarter Name Fallback (Ignores garbage words)
  if (name === "Nil" && lines.length > 0) {
    const invalidNameWords = ["resume", "cv", "curriculum", "profile", "page", "contact", "email", "phone", "details"];
    
    const possibleName = lines.slice(0, 5).find(line => { // Search top 5 lines
      const l = line.toLowerCase();
      return (
        !l.includes("@") &&
        !/\d/.test(l) && // No numbers
        l.length > 2 && 
        l.length < 25 &&
        !invalidNameWords.some(word => l.includes(word)) // Must not contain garbage words
      );
    });
    if (possibleName) name = possibleName;
  }

  // 7. Clean up College String
  if (college !== "Nil") {
    college = college
      .replace(/Highest\s*Degree/gi, "")
      .replace(/Education/gi, "")
      .replace(/B\.?Tech|B\.?E|BCA|MCA|MBA|B\.?Sc|M\.?Sc/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!college) college = "Nil";
  }

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

    // 🔥 PERFORMANCE UPGRADE: Initialize the OCR Worker ONCE for the whole batch
    console.log("⚙️ Booting up Tesseract OCR Engine...");
    const worker = await createWorker('eng');

    try {
      for (const file of files) {
        const startTime = Date.now();
        const originalPath = path.resolve(file.path);

        try {
          const fileBuffer = await fsPromises.readFile(originalPath);
          const hash = crypto.createHash("sha256").update(fileBuffer).digest("hex");

          // 1. Duplicate Check
          const existingRecord = await Record.findOne({ imageHash: hash }).lean();
          if (existingRecord) {
            console.log(`⏭️ Skipping duplicate: ${file.originalname}`);
            duplicates.push(file.originalname);
            await fsPromises.unlink(originalPath).catch(() => {});
            continue; 
          }

          // 2. Run OCR
          console.log(`📄 Reading ${file.originalname}...`);
          const { data: { text } } = await worker.recognize(originalPath);
          
          // 3. Extract Structured Data
          let extractedData = extractDataFromText(text);
          
          // Safety fallback: ensure name is never entirely empty
          if (extractedData.name === "Nil" || !extractedData.name) {
              extractedData.name = file.originalname.split('.')[0]; 
          }

          const loadingTime = ((Date.now() - startTime) / 1000).toFixed(2) + " sec";

          // 4. Save to Database
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
          // 5. Guaranteed cleanup of temp file on disk
          await fsPromises.unlink(originalPath).catch(() => {});
        }
      }
    } finally {
      // 🔥 Always terminate the worker after the loop, even if an error occurs
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