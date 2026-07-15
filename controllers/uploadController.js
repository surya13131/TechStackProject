import crypto from "crypto";
import fs from "fs";
import Tesseract from "tesseract.js";
import sharp from "sharp";
import { GoogleGenAI } from "@google/genai";
import Record from "../models/Record.js";

const fsPromises = fs.promises;

// Initialize Gemini (Ensure GEMINI_API_KEY is in your .env file)
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// ==========================================
// 1. DICTIONARIES & KEYWORDS (For Fallback)
// ==========================================

const DICT_LOCATIONS = [
  "Chennai", "OMR", "Sholinganallur", "Perungudi", "Tidel Park", 
  "Bangalore", "Bengaluru", "Hyderabad", "Pune", "Mumbai", 
  "Delhi", "Noida", "Gurgaon", "Coimbatore", "Kochi", 
  "Madurai", "Trichy", "Salem", "Tirunelveli", "Vellore"
];

const DICT_DEGREES = [
  "Computer Science Engineering", "Computer Science", "Information Technology",
  "Bachelor of Engineering", "Bachelor of Technology", 
  "B.Tech / B.E.", "B.Tech/B.E", "B.Tech", "B.E.", "B.E", 
  "M.Tech", "MBA", "MCA", "BCA", "B.Sc", "M.Sc", "B.Com", "Diploma"
];

const DICT_COLLEGES = [
  "Francis Xavier Engineering College", "Saraswathy College", 
  "K.C.S. Kasi Nadar College", "K.C.S.Kasi Nadar College",
  "Government Arts College", "Hindustan Institute of Technology", 
  "Anna University", "PSG College", "SRM University", 
  "Sairam Engineering College", "VIT", "St Joseph's College"
];

const findInDictionary = (text, dictionary) => {
  const lowerText = text.toLowerCase();
  for (const item of dictionary) {
    if (lowerText.includes(item.toLowerCase())) return item;
  }
  return null;
};

// ==========================================
// 2. GLOBAL EXTRACTORS & VALIDATORS
// ==========================================

const extractPhone = (text) => {
  if (!text || text === "Nil") return "Nil";
  // Strip everything except numbers to ensure Gemini's formatting doesn't break validation
  const digits = text.replace(/\D/g, "");
  if (digits.length >= 10) return digits.slice(-10);
  return "Nil";
};

const extractEmail = (text) => {
  if (!text || text === "Nil") return "Nil";
  const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0].toLowerCase() : "Nil";
};

const isValidName = (text) => {
  const invalidKeywords = /found|profiles|looking|resume|candidate|jobs|naukri|linkedin|shine|foundit|fresher|experience|applicable|student|details|notice|joiner|location|degree/i;
  if (invalidKeywords.test(text) || text.length < 3 || text.length > 30) return false;
  const lettersOnly = text.replace(/[^a-zA-Z]/g, '');
  if (lettersOnly.length < 3) return false;
  return true;
};

const cleanName = (text) => text.replace(/[^a-zA-Z\s.]/g, '').trim();

const detectPlatform = (text) => {
  const t = text.toLowerCase();
  if (t.includes("naukri") || t.includes("resdex")) return "Naukri";
  if (t.includes("shine") || t.includes("response likelihood")) return "Shine";
  if (t.includes("linkedin")) return "LinkedIn";
  if (t.includes("foundit") || t.includes("monster")) return "Foundit";
  if (t.includes("indeed")) return "Indeed";
  return "Nil";
};

// ==========================================
// 3. IMAGE PREPROCESSOR
// ==========================================

const preprocessImage = async (inputPath, outputPath) => {
  try {
    // Use a less aggressive preprocessing pipeline to preserve detail for OCR.
    await sharp(inputPath)
      .resize({ width: 2500 }) // Increased size for better OCR
      .grayscale()
      .normalize()
      .sharpen()
      .modulate({ brightness: 1.1, saturation: 1 }) // Adjust brightness
      .png() // Convert to PNG for consistency
      .toFile(outputPath);
    return true;
  } catch (error) {
    return false;
  }
};

// ==========================================
// 4. GEMINI VISION ENGINE (PRIMARY)
// ==========================================

const extractWithGemini = async (imagePath, ocrText) => {
  const imageBuffer = await fsPromises.readFile(imagePath);
  const base64Image = imageBuffer.toString("base64");
  
  const prompt = `
    You are reading ONE candidate profile screenshot.
    Return ONLY this JSON.
    {
     "name":"",
     "email":"",
     "phone":"",
     "location":"",
     "college":"",
     "department":"",
     "platform":""
    }

    Rules:
    - Read ONLY text visible in the screenshot.
    - Never guess. Never infer hidden text. Never reuse values from previous images.
    - If email is not visible return "Nil".
    - If phone is partially visible return "Nil".
    - If college is not visible return "Nil".
    - Ignore menu items, buttons, and navigation.
    - Ignore "Download Resume", "Candidate looking for job", and "Profile Details".
    - Output only JSON.
    
    Here is the text extracted by OCR, use it as the source of truth:
    --- OCR TEXT ---
    ${ocrText}
  `;

  const response = await ai.models.generateContent({
    model: "gemini-pro-vision", // Use a model that supports text and image inputs
    contents: [
      { inlineData: { mimeType: "image/png", data: base64Image } },
      { text: prompt }
    ]
  });

  // It's crucial to see the raw output before parsing.
  console.log("🤖 RAW GEMINI OUTPUT:\n", response.text);

  const rawText = response.text.replace(/```json/g, "").replace(/```/g, "").trim();
  return JSON.parse(rawText);
};

// ==========================================
// 5. TESSERACT ENGINE (FALLBACK)
// ==========================================

const parseNaukri = (lines, fullText) => {
  const data = { name: "Nil", email: "Nil", phone: "Nil", college: "Nil", department: "Nil", location: findInDictionary(fullText, DICT_LOCATIONS) || "Nil", platform: "Naukri" };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lowerLine = line.toLowerCase();
    if (data.name === "Nil" && lowerLine.includes("profiles found")) {
      const windowText = lines.slice(i, i + 2).join(" ");
      const pieces = windowText.split(/profiles found\s*>?/i);
      if (pieces.length > 1) {
        const potentialName = cleanName(pieces[1].split(/\s{2,}/)[0]); 
        if (isValidName(potentialName)) data.name = potentialName;
      }
    }
    if (lowerLine.includes("highest degree")) {
      const eduBlock = lines.slice(i, i + 4).join(" ");
      data.department = findInDictionary(eduBlock, DICT_DEGREES) || "Nil";
      data.college = findInDictionary(eduBlock, DICT_COLLEGES) || "Nil";
      if (data.college === "Nil") {
        const collegeMatch = eduBlock.match(/([a-zA-Z\s.-]+(?:College|University|Institute|Academy|School)[a-zA-Z\s.-]*)/i);
        if (collegeMatch) data.college = collegeMatch[1].trim();
      }
    }
    if (data.email === "Nil" && line.includes("@")) data.email = extractEmail(line);
    if (data.phone === "Nil" && /\d{10}/.test(line)) data.phone = extractPhone(line);
  }
  return data;
};

const parseShine = (lines, fullText) => {
  const data = { name: "Nil", email: "Nil", phone: "Nil", college: "Nil", department: "Nil", location: findInDictionary(fullText, DICT_LOCATIONS) || "Nil", platform: "Shine" };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (data.email === "Nil" && line.includes("@")) data.email = extractEmail(line);
    if (data.phone === "Nil" && /\+91[- ]?\d{10}/.test(line)) data.phone = extractPhone(line);
    if (data.name === "Nil" && i < 5) {
      const potentialName = cleanName(line);
      if (isValidName(potentialName)) data.name = potentialName;
    }
    if (data.department === "Nil") {
      const dept = findInDictionary(line, DICT_DEGREES);
      if (dept) data.department = dept;
    }
  }
  return data;
};

const parseGeneric = (lines, fullText) => {
  const data = { name: "Nil", email: "Nil", phone: "Nil", college: "Nil", department: "Nil", location: findInDictionary(fullText, DICT_LOCATIONS) || "Nil", platform: "Nil" };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (data.email === "Nil" && line.includes("@")) data.email = extractEmail(line);
    if (data.phone === "Nil" && /\d{10}/.test(line)) data.phone = extractPhone(line);
    if (data.department === "Nil") {
       const dept = findInDictionary(line, DICT_DEGREES);
       if (dept) data.department = dept;
    }
    if (data.college === "Nil") {
      const col = findInDictionary(line, DICT_COLLEGES);
      if (col) data.college = col;
      else if (/(college|university|institute|academy)/i.test(line) && !/(bachelor|master|degree)/i.test(line)) {
        data.college = line.trim();
      }
    }
  }
  return data;
};

const extractWithTesseract = async (imagePath) => {
  const { data } = await Tesseract.recognize(imagePath, "eng");
  const normalizedText = data.text.replace(/rn/g, 'm').replace(/0/g, 'O'); 
  const lines = normalizedText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  const fullText = lines.join(" ");
  const platform = detectPlatform(fullText);

  if (platform === "Naukri") return parseNaukri(lines, fullText);
  if (platform === "Shine") return parseShine(lines, fullText);
  
  const genericData = parseGeneric(lines, fullText);
  genericData.platform = platform; 
  return genericData;
};

// ==========================================
// 6. MAIN CONTROLLER
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
      const originalPath = file.path;
      const preprocessedPath = `${originalPath}-processed.png`;

      try {
        const fileBuffer = await fsPromises.readFile(originalPath);
        const hash = crypto.createHash("sha256").update(fileBuffer).digest("hex");

        const existingRecord = await Record.findOne({ imageHash: hash }).lean();

        if (existingRecord) {
          duplicates.push(file.originalname);
          continue; 
        }

        const preprocessingSuccess = await preprocessImage(originalPath, preprocessedPath);
        const targetImagePath = preprocessingSuccess ? preprocessedPath : originalPath;

        // --- New Hybrid Pipeline Step 1: Always run Tesseract first ---
        const { data: ocrData } = await Tesseract.recognize(targetImagePath, "eng");
        const normalizedOcrText = ocrData.text.replace(/rn/g, 'm').replace(/0/g, 'O');
        const ocrLines = normalizedOcrText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
        const fullOcrText = ocrLines.join(" ");

        let extractedFields;
        let usedTesseractFallback = false;

        // --- New Hybrid Pipeline Step 2: Try Gemini with Image + OCR Text ---
        try {
          if (!process.env.GEMINI_API_KEY) throw new Error("No API Key configured in environment variables.");
          extractedFields = await extractWithGemini(targetImagePath, fullOcrText);
          console.log(`✅ Gemini successfully parsed: ${file.originalname}`);
        } catch (geminiError) {
          console.error(`❌ GEMINI API FAILED for ${file.originalname}`);
          console.error(`🔍 ERROR DETAILS:`, geminiError.message || geminiError);
          console.warn(`⚠️ Falling back to Tesseract OCR...`);
          extractedFields = await extractWithTesseract(targetImagePath);
          usedTesseractFallback = true;
        }

        // --- VALIDATION & CORRECTION GATE ---
        // As you correctly pointed out, never trust the LLM for fixed-format data.
        // Use regex on the full OCR text as the source of truth for phone and email.
        const phoneMatch = fullOcrText.match(/(?:\+91[- ]?)?[6-9]\d{9}/);
        const phoneFromRegex = phoneMatch ? phoneMatch[0].replace(/\D/g, "").slice(-10) : "Nil";
        const emailFromRegex = extractEmail(fullOcrText) || "Nil";

        extractedFields.phone = phoneFromRegex;
        extractedFields.email = emailFromRegex;

        // If Gemini's output is invalid (e.g., bad name), use Tesseract parser as a fallback.
        console.log("Validating Gemini name:", extractedFields.name); // Log the name for debugging.
        if (!usedTesseractFallback && !isValidName(extractedFields.name || "")) {
            console.warn(`⚠️ Gemini output for ${file.originalname} has invalid name. Re-running with Tesseract.`);
            const tesseractFields = await extractWithTesseract(targetImagePath);
            // Merge results, preferring Tesseract's name but keeping other Gemini fields if valid.
            if (isValidName(tesseractFields.name)) extractedFields.name = tesseractFields.name;
            if (extractedFields.department === "Nil") extractedFields.department = tesseractFields.department;
            if (extractedFields.college === "Nil") extractedFields.college = tesseractFields.college;
            if (extractedFields.location === "Nil") extractedFields.location = tesseractFields.location;
        }

        const loadingTime = ((Date.now() - startTime) / 1000).toFixed(2) + " sec";

        // Now, we can create the record with validated and corrected data.
        const newRecord = await Record.create({
          imageHash: hash,
          ...extractedFields,
          loadingTime,
        });

        results.push(newRecord);

      } catch (fileError) {
        console.error(`File processing error:`, fileError);
      } finally {
        await fsPromises.unlink(originalPath).catch(() => {});
        await fsPromises.unlink(preprocessedPath).catch(() => {});
      }
    }

    res.status(200).json({ processed: results, duplicates });
  } catch (err) {
    console.error("Upload Error:", err);
    res.status(500).json({ error: "Server Error" });
  }
};