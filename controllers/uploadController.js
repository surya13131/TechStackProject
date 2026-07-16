import mongoose from "mongoose";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { createWorker } from "tesseract.js";
import Record from "../models/Record.js";

const fsPromises = fs.promises;

// ==========================================
// 1. PIPELINE UTILS, REGEX & NORMALIZERS
// ==========================================

// CRITICAL FIX: Added \b word boundaries so "ME" doesn't match inside "Resume" or "Home"
// Added support for "B.Tech/B.E" inline matches.
const degreeRegex = /\b(B(?:\.|\s)?TECH(?:\s*[\/|]\s*B(?:\.|\s)?E)?|B(?:\.|\s)?E|B(?:\.|\s)?SC|BCA|MBA|MCA|M(?:\.|\s)?TECH|M(?:\.|\s)?E|BCOM|BA|Bachelor\s+of\s+Engineering)\b(?:\s*[-/]?\s*(CSE|ECE|EEE|IT|MECH|CIVIL|AIDS|AI&DS|AI&ML|CSBS))?/i;
const phoneRegex = /(?:\+91[- ]?)?([6-9]\d{9})(?!\d)/;

// Precompiled Location Regexes
const priorityCities = ["Chennai", "Bangalore", "Hyderabad", "Pune"];
const techHubs = ["Mumbai", "Coimbatore", "Noida", "Gurgaon", "Delhi"];
const cityPatterns = [...priorityCities, ...techHubs].map(city => ({
  city,
  regex: new RegExp(`\\b${city}\\b`, "i")
}));

// Specific keywords for safe college extraction
const collegeKeywords = ["college", "university", "institute", "academy", "engineering", "polytechnic"];

const cleanOCR = (text) => {
  const garbage = [
    "save", "print", "no comments", "report profile", 
    "schedule video call", "send invite", "send nvite", "forward", 
    "call candidate", "download resume", "add comments", "recent"
  ];
  let cleaned = text.replace(/[|]/g, " ").replace(/\s{2,}/g, " ").replace(/[^\S\r\n]+/g, " ");
  for (const g of garbage) {
    cleaned = cleaned.replace(new RegExp(`\\b${g}\\b`, "gi"), "");
  }
  return cleaned.trim();
};

const detectPlatform = (text) => {
  const t = text.toLowerCase();
  if (t.includes("naukri")) return "Naukri";
  if (t.includes("shine")) return "Shine";
  if (t.includes("linkedin")) return "LinkedIn";
  return "Generic";
};

const normalizeDegree = (val) => val ? val.replace(/\./g, "").replace(/\s+/g, " ").trim().toUpperCase() : "Nil";
const normalizeCollege = (val) => val ? val.replace(/\s+/g, " ").trim() : "Nil";
const normalizeName = (val) => val ? val.replace(/\s+/g, " ").trim() : "Nil";

const emailToName = (email) => {
  if (!email || email === "Nil") return "Nil";
  let recovered = email.split("@")[0].replace(/[._-]/g, " ").replace(/\d+/g, "").replace(/\s+/g, " ").trim();
  return recovered.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || "Nil";
};

// CRITICAL FIX: Expanded blacklist to block "Volunteer", "Student", "Intern", etc.
const invalidNameWords = [
  "Jobs", "Responses", "Reports", "Report", "Profile", "Profiles",
  "Comments", "Candidate", "Candidates", "Schedule", "Forward",
  "Whatsapp", "Call", "Download", "Resume", "Workspace", "Admin",
  "Home", "Find", "Employer", "Degree", "Location", 
  "Fresher", "Available", "Join", "Current", "Volunteer", 
  "Student", "Intern", "Internship", "Trainee", "Applicable", "Summary", "Details"
];

const isCandidateName = (line) => {
  if (line.length < 3 || line.length > 45) return false;
  if (/\d/.test(line)) return false;
  
  for (const word of invalidNameWords) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(line)) return false;
  }
  
  const words = line.trim().split(/\s+/);
  if (words.length > 5) return false;
  
  // Reject single words that are less than 3 chars (OCR artifacts like "A" or "Na")
  // But allow things like "Varsha M" where "M" is just an initial
  if (words.length === 1 && words[0].length < 3) return false;
  
  return words.every(w => /^[A-Za-z.\s]+$/.test(w));
};

const extractLocation = (textBlock) => {
  for (const { city, regex } of cityPatterns) {
    if (regex.test(textBlock)) return city;
  }
  return "Nil";
};

// ==========================================
// 2. PARSERS (Strategy Pattern)
// ==========================================

// --- NAUKRI PARSER ---
const extractNaukri = (lines) => {
  let name = "Nil", email = "Nil", phone = "Nil";
  let location = "Nil", college = "Nil", degree = "Nil", specialization = "Nil";

  const headerLines = lines.slice(0, 10);
  for (const line of headerLines) {
    if (isCandidateName(line)) {
      name = normalizeName(line);
      break;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (lower.includes("fresher") || lower.includes("0 yr") || lower.includes("0 years")) {
      const locationContext = lines.slice(i, i + 3).join(" ");
      const foundLocation = extractLocation(locationContext);
      if (foundLocation !== "Nil") {
        location = foundLocation;
        break;
      }
    }
  }

  const highestIdx = lines.findIndex(line => 
    /highest\s*degree/i.test(line) || line.toLowerCase().includes("highest")
  );

  for (const line of lines) {
    if (line.includes("@") && email === "Nil") {
      const eMatch = line.match(/\S+@\S+\.\S+/);
      if (eMatch) email = eMatch[0].toLowerCase();
    }
  }

  const searchStartIdx = highestIdx !== -1 ? highestIdx : 0;
  let searchBlock = [];
  for (let i = searchStartIdx; i < lines.length; i++) {
    if (lines[i].includes("@")) break;
    searchBlock.push(lines[i]);
  }
  const phoneText = searchBlock.join(" ");
  const pMatch = phoneText.match(phoneRegex);
  if (pMatch) phone = pMatch[1];

  if (highestIdx !== -1) {
    const highestLine = lines[highestIdx];
    
    const inlineDegreeMatch = highestLine.match(degreeRegex);
    if (inlineDegreeMatch) {
      degree = normalizeDegree(inlineDegreeMatch[1]);
      if (inlineDegreeMatch[2]) specialization = normalizeDegree(inlineDegreeMatch[2]);
    }
    
    const inlineCollegeMatch = highestLine.match(/(.*college.*|.*university.*|.*institute.*|.*academy.*|.*engineering.*|.*polytechnic.*)/i);
    if (inlineCollegeMatch) {
       let rawCol = inlineCollegeMatch[1];
       if (inlineDegreeMatch) rawCol = rawCol.replace(inlineDegreeMatch[0], "");
       rawCol = rawCol.replace(/highest\s*degree[:\s-]*/i, ""); 
       
       if (rawCol.trim().length > 5) {
         college = normalizeCollege(rawCol);
       }
    }

    if (college === "Nil") {
      const collegeLines = [];
      
      for (let i = highestIdx + 1; i < lines.length; i++) {
        const lineLower = lines[i].toLowerCase();
        
        if (phoneRegex.test(lines[i]) || lines[i].includes("@") || /(modified|active)/i.test(lineLower)) break;
        
        if (collegeKeywords.some(k => lineLower.includes(k))) {
          collegeLines.push(lines[i]);
        }
        
        if (degree === "Nil") {
          const degreeMatch = lines[i].match(degreeRegex);
          if (degreeMatch) {
            degree = normalizeDegree(degreeMatch[1]);
            if (degreeMatch[2]) specialization = normalizeDegree(degreeMatch[2]);
          }
        }
      }
      
      let rawCollege = collegeLines.join(" ");
      if (rawCollege) {
        const matchedDegree = rawCollege.match(degreeRegex);
        if (matchedDegree) {
          college = normalizeCollege(rawCollege.replace(matchedDegree[0], ""));
        } else {
          college = normalizeCollege(rawCollege);
        }
      }
    }
  }

  return { name, email, phone, location, college, degree, specialization };
};

// --- SHINE PARSER ---
const extractShine = (lines) => {
  let name = "Nil", email = "Nil", phone = "Nil";
  let location = "Nil", college = "Nil", degree = "Nil", specialization = "Nil";

  const headerLines = lines.slice(0, 10);
  for (const line of headerLines) {
    if (isCandidateName(line)) {
      name = normalizeName(line);
      break;
    }
  }

  for (const line of lines) {
    if (line.includes("@") && email === "Nil") {
      const eMatch = line.match(/\S+@\S+\.\S+/);
      if (eMatch) email = eMatch[0].toLowerCase();
    }
  }

  let searchBlock = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("@")) break;
    searchBlock.push(lines[i]);
  }
  const phoneText = searchBlock.join(" ");
  const pMatch = phoneText.match(phoneRegex);
  if (pMatch) phone = pMatch[1];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineLower = line.toLowerCase();

    const degreeMatch = line.match(degreeRegex);
    if (degreeMatch && degree === "Nil") {
      degree = normalizeDegree(degreeMatch[1]);
      if (degreeMatch[2]) specialization = normalizeDegree(degreeMatch[2]);
      
      // CRITICAL FIX: Ensure degree substring is removed if college is on the same line
      let potentialCollege = line.replace(degreeMatch[0], "").trim() || (lines[i+1] ? lines[i+1].trim() : "");
      
      if (potentialCollege && collegeKeywords.some(k => potentialCollege.toLowerCase().includes(k))) {
         college = normalizeCollege(potentialCollege);
      }
    }
    
    if (college === "Nil" && collegeKeywords.some(k => lineLower.includes(k))) {
       college = normalizeCollege(line);
    }
    
    if (location === "Nil") {
      const foundLocation = extractLocation(line);
      if (foundLocation !== "Nil") location = foundLocation;
    }
  }

  return { name, email, phone, location, college, degree, specialization };
};

// --- GENERIC PARSER (Fallback) ---
const extractGeneric = (lines, text) => {
  const getField = (labelRegex) => {
    const match = text.match(labelRegex);
    return match ? match[1].split("\n")[0].trim() : "Nil";
  };

  let name = normalizeName(getField(/(?:Name|Candidate Name)\s*[:\-]?\s*([A-Za-z .]{3,40})/i));
  let email = (text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,8}\b/i) || ["Nil"])[0].toLowerCase();
  
  if (name === "Nil" && email !== "Nil") {
    name = emailToName(email);
  }
  
  let phone = "Nil";
  const p = text.match(phoneRegex);
  if (p) phone = p[1];

  let degree = "Nil", specialization = "Nil";
  const deptMatch = text.match(degreeRegex);
  if (deptMatch) {
    degree = normalizeDegree(deptMatch[1]);
    if (deptMatch[2]) specialization = normalizeDegree(deptMatch[2]);
  }

  let college = "Nil";
  for (const line of lines) {
     if (collegeKeywords.some(k => line.toLowerCase().includes(k))) {
         college = normalizeCollege(line);
         break;
     }
  }
  
  let location = extractLocation(text);

  return { name, email, phone, location, college, degree, specialization };
};

// ==========================================
// 3. COMMON VALIDATION
// ==========================================
const isValidValue = (val) => {
  if (!val || val === "Nil") return true; 
  const lower = val.toLowerCase();
  const badValues = ["download resume", "call candidate", "save", "print", "comments", "profile", "workspace", "home", "education", "experience"];
  return !badValues.some(bad => lower.includes(bad));
};

const commonValidation = (data, platform, fileName) => {
  if (!data.name || data.name === "Nil" || !isValidValue(data.name) || /^\d+$/.test(data.name.replace(/\s/g, ''))) {
    let potentialName = fileName.split('.')[0].replace(/[_-]/g, ' ').trim();
    data.name = /^\d+$/.test(potentialName.replace(/\s/g, '')) ? "Nil" : normalizeName(potentialName);
  }

  if (data.name === "Nil" && data.email !== "Nil") {
    data.name = emailToName(data.email);
  }

  if (!isValidValue(data.college)) data.college = "Nil";
  if (!isValidValue(data.location)) data.location = "Nil";

  if (data.location !== "Nil") {
    data.location = data.location.charAt(0).toUpperCase() + data.location.slice(1).toLowerCase();
  }

  if (data.college && data.college.length > 80) {
    data.college = data.college.substring(0, 77) + "...";
  }

  return { ...data, platform };
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

    await worker.setParameters({
      tessedit_pageseg_mode: "6",
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
      tessedit_char_blacklist: "|{}[]"
    });

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

          const processedImageBuffer = await sharp(fileBuffer)
            .resize({ width: 1800, withoutEnlargement: true }) 
            .grayscale()
            .normalize()
            .sharpen({ sigma: 1.2 })
            .threshold(170)
            .png()
            .toBuffer();

          const { data } = await worker.recognize(processedImageBuffer);
          
          const cleanedText = cleanOCR(data.text);
          const platform = detectPlatform(cleanedText);
          const lines = cleanedText.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
          
          let extractedData;
          switch (platform) {
            case "Naukri":
              extractedData = extractNaukri(lines);
              break;
            case "Shine":
              extractedData = extractShine(lines);
              break;
            default:
              extractedData = extractGeneric(lines, cleanedText);
          }

          const finalData = commonValidation(extractedData, platform, file.originalname);
          
          // ========================================================
          // Safe Debug Logging Suite
          // ========================================================
          console.log("\n========== OCR RAW TEXT ==========");
          console.log(data.text);
          
          console.log("\n========== LINES ARRAY ==========");
          lines.forEach((l, i) => console.log(`[${i}] ${l}`));
          
          console.log("\n========== PARSED OUTPUT ==========");
          console.table({
            platform: finalData.platform,
            name: finalData.name,
            phone: finalData.phone,
            email: finalData.email,
            location: finalData.location,
            college: finalData.college,
            degree: finalData.degree,
            specialization: finalData.specialization
          });
          
          console.log("\n========== WORDS & BBOX ==========");
          if (data.words && Array.isArray(data.words)) {
            data.words.forEach(w => {
              console.log(
                w.text,
                w.bbox ? w.bbox : ""
              );
            });
          } else {
            console.log("No word data available in this execution.");
          }
          console.log("========================================================\n");

          const loadingTime = ((Date.now() - startTime) / 1000).toFixed(2) + " sec";
          
          console.log("Saving to MongoDB...");
          console.log(finalData);
          try {
            const newRecord = await Record.create({ imageHash: hash, ...finalData, loadingTime });
            console.log(`✅ Saved Successfully: ${file.originalname}`);
            results.push(newRecord);
          } catch (dbErr) {
            console.error(`❌ MongoDB Save Error for ${file.originalname}:`, dbErr);
          }
          
        } catch (err) {
          console.error(`Error processing file ${file.originalname}:`, err);
        } finally {
          await fsPromises.unlink(originalPath).catch(() => {});
        }
      }
    } finally {
      await worker.terminate();
    }

    res.status(201).json({ processed: results, duplicates });
  } catch (err) {
    console.error("❌ Top-level processImages error:", err);
    res.status(500).json({ error: "An unexpected server error occurred." });
  }
};

// ==========================================
// Fetch, Update, Delete Controllers
// ==========================================
export const getRecords = async (req, res) => {
  try {
    const records = await Record.find().sort({ createdAt: -1 }).lean();
    res.status(200).json(records);
  } catch (err) {
    console.error("❌ Error fetching records:", err);
    res.status(500).json({ error: "Server error while fetching records." });
  }
};

export const updateRecord = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid ID format." });

    const secureUpdate = { 
      name: req.body.name, 
      email: req.body.email, 
      phone: req.body.phone, 
      location: req.body.location, 
      college: req.body.college, 
      degree: req.body.degree, 
      specialization: req.body.specialization,
      platform: req.body.platform 
    };

    const updated = await Record.findByIdAndUpdate(id, { $set: secureUpdate }, { new: true, runValidators: true }).lean(); 
    if (!updated) return res.status(404).json({ error: "Record not found." });

    res.status(200).json(updated);
  } catch (err) {
    console.error(`❌ Error updating record ${req.params.id}:`, err);
    res.status(500).json({ error: "Server error." });
  }
};

export const deleteRecord = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid ID format." });

    const deleted = await Record.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ error: "Record not found." });

    res.status(200).json({ message: "Record deleted successfully.", deletedId: id });
  } catch (err) {
    console.error(`❌ Error deleting record ${req.params.id}:`, err);
    res.status(500).json({ error: "Server error." });
  }
};