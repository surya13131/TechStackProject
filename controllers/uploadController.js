import crypto from "crypto";
import fs from "fs";
import path from "path";
import { createWorker } from "tesseract.js";
import Record from "../models/Record.js";

const fsPromises = fs.promises;

// ==========================================
// 🧠 FINE-TUNED EXTRACTION ENGINE
// ==========================================
const extractDataFromText = (text) => {
  let name = "Nil";
  let email = "Nil";
  let phone = "Nil";
  let location = "Nil";
  let college = "Nil";
  let department = "Nil";
  let platform = "Nil";

  const cleanedText = text
    .replace(/[\u200B-\u200D\uFEFF|~*^_{}[\]\\]/g, ' ')
    .replace(/[ \t]+/g, ' ') 
    .trim();
    
  const lowerText = cleanedText.toLowerCase();
  const lines = cleanedText.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 2);
  const flatText = cleanedText.replace(/\r?\n/g, ' '); 

  // 1. PHONE EXTRACTION (ULTIMATE FIX)
  // Extracts 10 digits starting with 6-9, allowing spaces/dashes, BUT explicitly rejecting numbers 
  // attached to URLs, letters, or query parameters (like =, &, ?) to avoid session IDs like "8556260561"
  const phoneRegex = /(?<![a-zA-Z0-9=&?])(?:\+?91[\s-]?)?([6-9][\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d)(?![a-zA-Z0-9=&?])/g;
  const phoneMatches = [...flatText.matchAll(phoneRegex)];
  
  for (const m of phoneMatches) {
     const cleanNum = m[1].replace(/[\s-]/g, '');
     if (cleanNum.length === 10) {
        phone = cleanNum;
        break; // Stop at the first valid, clean mobile number
     }
  }

  // 2. EMAIL EXTRACTION
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,8}\b/i;
  const emailMatch = flatText.match(emailRegex);
  if (emailMatch) email = emailMatch[0].toLowerCase();

  // 3. PLATFORM EXTRACTION
  if (/\bnaukri\b/i.test(lowerText)) platform = "Naukri";
  else if (/\bshine\b/i.test(lowerText)) platform = "Shine";
  else if (/\blinkedin\b/i.test(lowerText)) platform = "LinkedIn";
  else if (/\bfoundit\b|\bmonster\b/i.test(lowerText)) platform = "Foundit";
  else if (/\bindeed\b/i.test(lowerText)) platform = "Indeed";

  // 4. LOCATION EXTRACTION
  const techHubs = ["chennai", "omr", "sholinganallur", "perungudi", "tidel park", "bangalore", "hyderabad", "pune", "mumbai", "coimbatore"];
  for (const city of techHubs) {
    if (new RegExp(`\\b${city}\\b`, 'i').test(flatText)) {
      location = city.length <= 3 ? city.toUpperCase() : city.charAt(0).toUpperCase() + city.slice(1);
      break;
    }
  }

  // 5. COLLEGE & DEPARTMENT CLEANER (FIXED)
  // 🛑 Added "highest degree", "highest", and "degree" to the garbage collection
  const uiGarbage = ["highest degree", "highest", "degree", "fresher", "chennai", "modified", "active", "yesterday", "v", "e", "u", "s", "no comments", "save", "print", "nex", "qsave"];
  
  for (const line of lines) {
    const lowerLine = line.toLowerCase();
    
    if (/(university|college|institute|academy)/i.test(lowerLine)) {
      
      let cleanLine = line.replace(/[0-9]/g, ''); 
      
      uiGarbage.forEach(word => {
         const re = new RegExp(`\\b${word}\\b`, 'gi');
         cleanLine = cleanLine.replace(re, " "); 
      });
      
      const degreePattern = /\b(B\.?C\.?A|B\.?Sc|B\.?Tech|B\.?E|M\.?C\.?A|M\.?B\.?A|M\.?Sc|B\.?A|B\.?Com)\b/i;
      const match = cleanLine.match(degreePattern);
      
      if (match) {
        department = match[0].toUpperCase().replace(/\./g, '');
        cleanLine = cleanLine.replace(match[0], "").replace(/[:\-]/g, " ").trim();
      } else {
        cleanLine = cleanLine.replace(/[:\-]/g, " ").trim();
      }

      const targetedCollegeMatch = cleanLine.match(/([a-zA-Z\s.,&'-]{3,60}\b(?:College|University|Institute|Academy)\b(?:\s+of\s+[a-zA-Z\s.,&'-]+)?)/i);
      
      if (targetedCollegeMatch) {
        college = targetedCollegeMatch[1];
      } else {
        college = cleanLine;
      }
      
      college = college.replace(/\s+/g, ' ').trim();
      college = college.replace(/[,.]$/, '').trim(); 
      break; 
    }
  }

  // 6. NAME SPLITTER
  if (email !== "Nil") {
    const emailPrefix = email.split('@')[0];
    let nameParts = emailPrefix.replace(/[0-9]/g, '').replace(/[._-]/g, ' ').trim();
    
    if (!nameParts.includes(' ')) {
        nameParts = nameParts.replace(/([a-z])([A-Z])/g, '$1 $2');
    }
    
    if (nameParts.length > 1) {
       name = nameParts.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }
  }

  return { 
    name: name || "Nil", 
    email, 
    phone, 
    location, 
    college: college.length > 5 ? college : "Nil", 
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
          
          if (!extractedData.name || extractedData.name === "Nil" || /^\d+$/.test(extractedData.name.replace(/\s/g, ''))) {
             let potentialName = file.originalname.split('.')[0].replace(/[_-]/g, ' ').trim();
             
             if (/^\d+$/.test(potentialName.replace(/\s/g, ''))) {
                 extractedData.name = "Nil";
             } else {
                 extractedData.name = potentialName;
             }
          }

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