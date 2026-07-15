import { GoogleGenerativeAI } from "@google/genai";
import TechStack from "../models/TechStack.js";
import fs from "fs";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * @description Process uploaded images, get OCR text, and generate analysis from Gemini
 * @route POST /api/upload
 */
export const processImages = async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "No images uploaded." });
  }

  try {
    const image = req.files[0]; // Process the first image
    const originalPath = image.path;

    // 2. Prepare data for Gemini
    const model = genAI.getGenerativeModel({ model: "gemini-pro-vision" });

    const imagePart = {
      inlineData: {
        data: fs.readFileSync(originalPath).toString("base64"),
        mimeType: image.mimetype,
      },
    };

    const prompt = `
      You are extracting candidate information from a recruiter screenshot.

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

      - Read ONLY visible text.
      - Never guess.
      - Candidate name is the largest bold name.
      - Extract the exact email.
      - Extract the complete 10-digit phone number.
      - Extract the latest degree.
      - Extract the college name only.
      - Ignore menus, advertisements, buttons, recruiter names and UI elements.
      - If a value is missing return "Nil".

      Return JSON only.
    `;

    const contents = [imagePart, { text: prompt }];

    // 3. Call Gemini API
    const result = await model.generateContent({ contents });
    const responseText = result.response.text();
    const analysis = JSON.parse(responseText.replace(/```json\n?|\n?```/g, ""));

    // 4. Save to MongoDB
    const newRecord = new TechStack({
      title: analysis.title,
      summary: analysis.summary,
      imageUrl: originalPath, // Note: In a real app, you'd upload this to a cloud storage and save the URL
    });
    await newRecord.save();

    res.status(201).json(newRecord);
  } catch (error) {
    console.error("Error processing images:", error);
    res.status(500).json({ error: "Server error during image processing." });
  }
};