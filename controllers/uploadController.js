import crypto from "crypto";
import fs from "fs";
import path from "path";
import axios from "axios";
import FormData from "form-data";
import { GoogleGenAI, Type } from "@google/genai";
import Record from "../models/Record.js";

const fsPromises = fs.promises;

// Initialize Gemini (Single Instance)
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

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

    // Use Environment Variable with a local fallback
    const OCR_API = process.env.OCR_API || "http://localhost:8000/ocr";

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

        // 2. Call Python OCR Microservice via FormData
        let ocrText = "";
        try {
          console.log(`📡 Sending ${file.originalname} to Python OCR API at ${OCR_API}...`);
          
          const form = new FormData();
          form.append("file", fs.createReadStream(originalPath));

          const ocrResponse = await axios.post(OCR_API, form, {
            headers: form.getHeaders() // Crucial for multipart/form-data
          });
          
          ocrText = ocrResponse.data.text;
          console.log(`✅ Python OCR extracted ${ocrText.length} characters.`);
          
        } catch (ocrError) {
          console.error("❌ Python OCR Microservice failed:", ocrError.message);
          ocrText = "OCR Microservice Failed. Please read the image directly."; 
        }

        // 3. Extract Data using Gemini (Combining Image + OCR Text)
        let extractedFields = {};
        const base64Image = fileBuffer.toString("base64");

        // Consolidated, single prompt leveraging both image and OCR
        const prompt = `
          You are an exact data parsing tool. Look at the attached recruiter profile screenshot AND the raw OCR text below.
          
          RAW OCR TEXT:
          """
          ${ocrText}
          """
          
          CRITICAL RULES:
          1. Use the OCR text to extract the data, but verify spelling against the image.
          2. DO NOT HALLUCINATE OR GUESS. Read ONLY visible text.
          3. Candidate name is the largest bold name.
          4. Extract the exact email and the complete 10-digit phone number.
          5. Extract the latest degree and the college name only.
          6. Ignore menus, advertisements, buttons, recruiter names and UI elements.
          7. Platform must be strictly one of: "Naukri", "LinkedIn", "Foundit", "Shine", "Indeed", or "Nil".
          8. If a field is not visible, you MUST return "Nil".
        `;

        try {
          if (!process.env.GEMINI_API_KEY) throw new Error("No API Key configured.");

          // Single, clean Gemini API call using the current SDK structure
          const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
            contents: [
              prompt,
              { inlineData: { mimeType: file.mimetype, data: base64Image } }
            ],
            config: {
              temperature: 0.0,
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  email: { type: Type.STRING },
                  phone: { type: Type.STRING },
                  location: { type: Type.STRING },
                  college: { type: Type.STRING },
                  department: { type: Type.STRING },
                  platform: { type: Type.STRING }
                },
                required: ["name", "email", "phone", "location", "college", "department", "platform"]
              }
            }
          });

          extractedFields = JSON.parse(response.text);
          console.log(`✅ Gemini successfully formatted data for: ${file.originalname}`);

        } catch (err) {
          console.error(`❌ Gemini formatting failed for ${file.originalname}:`, err);
          extractedFields = {
            name: "Nil", email: "Nil", phone: "Nil", location: "Nil", 
            college: "Nil", department: "Nil", platform: "Nil"
          };
        }

        // 4. Strict Regex Validation
        const phoneRegex = /(?:(?:\+|0{0,2})91[\s-]?)?([6-9]\d{9})/;
        const phoneMatch = (extractedFields.phone || "").match(phoneRegex);
        extractedFields.phone = phoneMatch ? phoneMatch[1] : "Nil";

        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[A-Za-z]{2,}/;
        const emailMatch = (extractedFields.email || "").match(emailRegex);
        extractedFields.email = emailMatch ? emailMatch[0].toLowerCase() : "Nil";

        extractedFields.college = (extractedFields.college || "Nil")
            .replace(/Highest\s*Degree/gi, "")
            .replace(/Education/gi, "")
            .replace(/B\.?Tech|B\.?E|BCA|MCA|MBA|B\.?Sc|M\.?Sc/gi, "")
            .replace(/\s+/g, " ")
            .trim();
        if (!extractedFields.college) extractedFields.college = "Nil";

        const loadingTime = ((Date.now() - startTime) / 1000).toFixed(2) + " sec";

        // 5. Save Record to Database
        const newRecord = await Record.create({
          imageHash: hash,
          ...extractedFields, // Spreading validated fields cleanly
          loadingTime,
        });

        results.push(newRecord);

      } catch (fileError) {
        console.error(`❌ File processing error for ${file.originalname}:`, fileError);
      } finally {
        // 6. Clean up Node's local disk
        await fsPromises.unlink(originalPath).catch(() => {});
      }
    }

    res.status(200).json({ processed: results, duplicates });
  } catch (err) {
    console.error("Upload Error:", err);
    res.status(500).json({ error: "Server Error during processing." });
  }
};