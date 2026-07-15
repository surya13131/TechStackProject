import crypto from "crypto";
import fs from "fs";
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
    const image = sharp(inputPath);
    const meta = await image.metadata();
    const width = meta.width;
    const height = meta.height;

    await image
      // Crop out unnecessary UI elements like sidebars, menus, and ads.
      // Use percentages to adapt to different screenshot resolutions.
      .resize({ width: 2200, withoutEnlargement: true })
      .grayscale()
      .normalize()
      .sharpen()
      .modulate({ brightness: 1.15, saturation: 1 })
      .png()
      .toFile(outputPath);
    return true;
  } catch (error) {
    console.error("Image preprocessing failed:", error);
    return false;
  }
};

// ==========================================
// 4. GEMINI VISION ENGINE (PRIMARY)
// ==========================================

const extractWithGemini = async (imagePath) => {
  const imageBuffer = await fsPromises.readFile(imagePath);
  const base64Image = imageBuffer.toString("base64");
  
  const prompt = `
    You are reading ONE recruiter profile.

    Return ONLY JSON.

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

    Read only visible text.
    Never guess.
    Never infer.
    Never reuse values.
    Candidate name is usually the largest bold text.

    Ignore:
    - Profile Details
    - Download Resume
    - Jobs
    - Buttons
    - Icons
    - Advertisements
    - Recruiter menus

    Phone:
    Return only digits.

    Email:
    Return exact email.

    College:
    Return only institute name.

    Department:
    Return only degree.

    Platform must be one of "Naukri", "LinkedIn", "Foundit", "Shine", "Indeed", otherwise "Nil".

    If anything is not visible, return "Nil".

    Return JSON only.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      { inlineData: { mimeType: "image/png", data: base64Image } },
      { text: prompt }
    ]
  });

  return response;
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

        let extractedFields;

        // --- Primary Extraction Engine: Gemini ---
        try {
          if (!process.env.GEMINI_API_KEY) throw new Error("No API Key configured in environment variables.");
          const response = await extractWithGemini(targetImagePath);
          
          // Safely parse the JSON response from Gemini
          const raw = response.response.text();
          console.log("============== GEMINI RAW ==============");
          console.log(raw);
          console.log("========================================");
          const text = raw
              .replace(/```json/g,"")
              .replace(/```/g,"")
              .trim();
          extractedFields = JSON.parse(text);

          console.log(`✅ Gemini successfully parsed: ${file.originalname}`);

        } catch (err) {
          console.error(`❌ Gemini processing failed for ${file.originalname}:`, err);
          // If Gemini fails, create a default "Nil" object to avoid crashing.
          extractedFields = {
              name:"Nil",
              email:"Nil",
              phone:"Nil",
              location:"Nil",
              college:"Nil",
              department:"Nil",
              platform:"Nil"
          };
        }

        // --- Post-Processing and Validation ---
        const phoneRegex = /(?:\+91[\s-]?)?([6-9]\d{9})/;
        const phoneMatch = (extractedFields.phone || "").match(phoneRegex);
        extractedFields.phone = phoneMatch ? phoneMatch[1] : "Nil";

        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[A-Za-z]{2,}/;
        const emailMatch = (extractedFields.email || "").match(emailRegex);
        extractedFields.email = emailMatch ? emailMatch[0].toLowerCase() : "Nil";

        // Clean up college name from extra text
        extractedFields.college = (extractedFields.college || "")
            .replace(/Highest\s*Degree/gi,"")
            .replace(/Education/gi,"")
            .replace(/B\.?Tech|B\.?E|BCA|MCA|MBA|B\.?Sc|M\.?Sc/gi,"")
            .replace(/\s+/g," ")
            .trim();

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