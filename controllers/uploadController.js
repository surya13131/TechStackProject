import crypto from "crypto";
import fs from "fs";
import path from "path";
import { createWorker } from "tesseract.js";
import Record from "../models/Record.js";

const fsPromises = fs.promises;

// ==========================================
// TEXT PARSING ENGINE
// Hunts for specific patterns in the raw OCR dump
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

  // 1. Extract Phone Number (Indian format: 10 digits starting with 6-9)
  const phoneRegex = /(?:(?:\+|0{0,2})91[\s-]?)?([6-9]\d{9})/;
  const phoneMatch = text.match(phoneRegex);
  if (phoneMatch) phone = phoneMatch[1];

  // 2. Extract Email Address
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[A-Za-z]{2,}/;
  const emailMatch = text.match(emailRegex);
  if (emailMatch) email = emailMatch[0].toLowerCase();

  // 3. Detect Platform from URL or UI text
  if (lowerText.includes("naukri")) platform = "Naukri";
  else if (lowerText.includes("shine")) platform = "Shine";
  else if (lowerText.includes("linkedin")) platform = "LinkedIn";
  else if (lowerText.includes("foundit") || lowerText.includes("monster")) platform = "Foundit";
  else if (lowerText.includes("indeed")) platform = "Indeed";

  // 4. Detect Location (Basic Indian Tech Hubs Dictionary)
  const commonCities = ["chennai", "bangalore", "bengaluru", "hyderabad", "pune", "mumbai", "delhi", "noida", "gurugram", "gurgaon", "coimbatore"];
  for (const city of commonCities) {
    if (lowerText.includes(city)) {
      location = city.charAt(0).toUpperCase() + city.slice(1);
      break;
    }
  }

  // 5. Line-by-Line Heuristics for Name, College, Department
  const lines = text.split("\n").map(line => line.trim()).filter(line => line.length > 0);
  
  for (const line of lines) {
    const lowerLine = line.toLowerCase();
    
    if (lowerLine.startsWith("name:") || lowerLine.startsWith("candidate:")) {
      name = line.replace(/^(name|candidate):/i, "").trim();
    } else if (lowerLine.startsWith("college:") || lowerLine.startsWith("institute:") || lowerLine.startsWith("university:")) {
      college = line.replace(/^(college|institute|university):/i, "").trim();
    } else if (lowerLine.startsWith("department:") || lowerLine.startsWith("degree:") || lowerLine.startsWith("course:")) {
      department = line.replace(/^(department|degree|course):/i, "").trim();
    }
  }

  // Fallback for Name: If no explicit "Name:" label is found, grab the first non-garbage line
  if (name === "Nil" && lines.length > 0) {
    const possibleName = lines.find(l => 
      !l.includes("@") && 
      !/\d/.test(l) && // No numbers
      l.length > 3 && 
      l.length < 25 &&
      !l.toLowerCase().includes("resume") &&
      !l.toLowerCase().includes("profile")
    );
    if (possibleName) name = possibleName;
  }

  // Clean up college string if it found one
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
          console.log(`🤖 Performing OCR on ${file.originalname}...`);
          const { data: { text } } = await worker.recognize(originalPath);
          ocrText = text;
          console.log(`✅ Tesseract extracted ${ocrText.length} characters.`);
        } catch (tesseractError) {
          console.error("❌ Tesseract OCR failed:", tesseractError);
        } finally {
          await worker.terminate();
        }

        // 3. Parse the raw text into structured data
        let extractedData = extractDataFromText(ocrText);
        
        // Fallback: If absolutely everything failed, at least keep the filename as the name
        if (extractedData.name === "Nil") {
            extractedData.name = file.originalname;
        }

        const loadingTime = ((Date.now() - startTime) / 1000).toFixed(2) + " sec";

        // 4. Save Record to Database
        const newRecord = await Record.create({
          imageHash: hash,
          ...extractedData,
          loadingTime,
        });

        results.push(newRecord);

      } catch (fileError) {
        console.error(`❌ File processing error for ${file.originalname}:`, fileError);
      } finally {
        // 5. Clean up Node's local disk
        await fsPromises.unlink(originalPath).catch(() => {});
      }
    }

    res.status(200).json({ processed: results, duplicates });
  } catch (err) {
    console.error("Upload Error:", err);
    res.status(500).json({ error: "Server Error during processing." });
  }
};