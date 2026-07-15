import crypto from "crypto";
import fs from "fs";
import path from "path";
import { createWorker } from "tesseract.js";
import Record from "../models/Record.js";

const fsPromises = fs.promises;

// ==========================================
// 🧠 ADVANCED EXTRACTION ENGINE (FIXED SPLITTER v3)
// ==========================================
const extractDataFromText = (text) => {
  let name = "Nil";
  let email = "Nil";
  let phone = "Nil";
  let location = "Nil";
  let college = "Nil";
  let department = "Nil";
  let platform = "Nil";

  // ------------------------------------------------------------------
  // FIX (Bug A): keep TWO versions of the text.
  // - rawLines: split on the ORIGINAL newlines, each line only lightly
  //   cleaned (zero-width chars + internal extra spaces). This is what
  //   we use for line-based fields (college/department).
  // - cleanedText: fully whitespace-collapsed (newlines -> space too).
  //   Only used for whole-document regex like phone/email/platform/location.
  //
  // Previously cleanedText collapsed \n -> ' ' FIRST, then the code did
  // cleanedText.split("\n") — which returned ONE giant "line" containing
  // the entire OCR dump, so `college` ended up swallowing everything
  // (WhatsApp UI text, URLs, etc). That's fixed by splitting on the
  // ORIGINAL text before any newline-collapsing happens.
  // ------------------------------------------------------------------
  const stripZeroWidth = (s) => s.replace(/[\u200B-\u200D\uFEFF|~*^_{}[\]\\]/g, ' ');

  const rawLines = text
    .split(/\r?\n/)
    .map(line => stripZeroWidth(line).replace(/[ \t]+/g, ' ').trim())
    .filter(line => line.length > 2);

  const cleanedText = stripZeroWidth(text).replace(/\s+/g, ' ').trim();
  const lowerText = cleanedText.toLowerCase();

  // 1. Phone
  const phoneRegex = /(?<!\d)(?:\+?91[\s-]?)?([6-9]\d{9})\b/;
  const phoneMatch = cleanedText.match(phoneRegex);
  if (phoneMatch) phone = phoneMatch[1];

  // 2. Email
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,8}\b/;
  const emailMatch = cleanedText.match(emailRegex);
  if (emailMatch) email = emailMatch[0].toLowerCase();

  // 3. Platform
  if (/\bnaukri\b/i.test(lowerText)) platform = "Naukri";
  else if (/\bshine\b/i.test(lowerText)) platform = "Shine";
  else if (/\blinkedin\b/i.test(lowerText)) platform = "LinkedIn";
  else if (/\bfoundit\b|\bmonster\b/i.test(lowerText)) platform = "Foundit";
  else if (/\bindeed\b/i.test(lowerText)) platform = "Indeed";

  // 4. Location
  const techHubs = ["chennai", "omr", "sholinganallur", "perungudi", "bangalore", "bengaluru", "hyderabad", "pune", "mumbai", "delhi", "noida", "gurugram", "gurgaon", "coimbatore"];
  for (const city of techHubs) {
    if (new RegExp(`\\b${city}\\b`, 'i').test(cleanedText)) {
      location = city.length <= 3 ? city.toUpperCase() : city.charAt(0).toUpperCase() + city.slice(1);
      break;
    }
  }

  // ------------------------------------------------------------------
  // 5. DEPARTMENT / COLLEGE — now operates on rawLines (real lines),
  //    and instead of taking the ENTIRE line as "college", it pulls
  //    out just the "...College/University/Institute..." snippet.
  //    This means even if a line still has junk around it (URLs, UI
  //    text mixed in by OCR), we only keep the relevant chunk.
  // ------------------------------------------------------------------

  // Longer / more specific degrees checked first so short alternatives
  // (like B.A) can't shadow a real B.Tech / M.Tech etc.
  // \b...\b prevents matching inside words like "Bachelor".
  const degreePattern = /\b(B\.?\s?Tech|M\.?\s?Tech|B\.?\s?C\.?\s?A|M\.?\s?C\.?\s?A|B\.?\s?Sc|M\.?\s?Sc|M\.?\s?B\.?\s?A|B\.?\s?Com|B\.?\s?E|B\.?\s?A)\b/i;

  const eduKeywordRegex = /\b(college|university|institute|academy|polytechnic)\b/i;

  // Extracts just the institution-name-shaped chunk around the keyword,
  // e.g. from "...Fresher Chennai / BE. Francis Xavier Engineering
  // College, Tirunel.." it pulls "Francis Xavier Engineering College, Tirunel"
  // instead of the whole noisy line.
  const collegeSnippetPattern = /(?:[A-Z][A-Za-z.&'-]*\s+){0,6}(?:College|University|Institute|Academy|Polytechnic)(?:\s+(?:of|for|&|and|[A-Z][A-Za-z.&'-]*))*[A-Za-z.&'-]*/;

  const noiseWords = /\b(fresher|resume|profile|highest degree|education|qualification|whatsapp|call|candidate|modified|active|yesterday|forward|schedule|comments?)\b/gi;

  // Candidate lines: anything mentioning a degree token or an education keyword.
  const candidateLines = rawLines.filter(l => degreePattern.test(l) || eduKeywordRegex.test(l));

  // Shorter lines are far more likely to be a clean "Education: XYZ College"
  // entry rather than a giant OCR'd UI blob, so try those first.
  candidateLines.sort((a, b) => a.length - b.length);

  for (const line of candidateLines) {
    const degMatch = line.match(degreePattern);
    if (degMatch) {
      department = degMatch[0].toUpperCase().replace(/[.\s]/g, ""); // "B. Tech" -> "BTECH"
    }

    const collegeMatch = line.match(collegeSnippetPattern);
    if (collegeMatch) {
      college = collegeMatch[0].replace(/\s+/g, ' ').trim();
    } else {
      college = line
        .replace(degMatch ? degMatch[0] : "", "")
        .replace(noiseWords, "")
        .replace(/[:\-/]+/g, " ")
        .replace(/\s+/g, ' ')
        .trim();
    }

    // Safety net: never let a runaway line slip through as "college".
    if (college.length > 120) college = college.slice(0, 120).trim() + "...";

    if (college && college !== "Nil") break; // good candidate found, stop scanning
  }

  // 6. Fallback: If department still Nil, check keyword list with WORD BOUNDARIES
  // (plain .includes() previously matched "IT" inside "with", "limited", etc.)
  if (department === "Nil") {
    const deptKeywords = ["CSE", "ECE", "EEE", "MECH", "CIVIL", "MCA", "BCA", "MBA", "IT"];
    for (const d of deptKeywords) {
      if (new RegExp(`\\b${d}\\b`, "i").test(cleanedText)) {
        department = d;
        break;
      }
    }
  }

  // ------------------------------------------------------------------
  // 7. Name Inference
  // FIX (Bug B): digits were being DELETED ("" ) instead of replaced
  // with a space, so "surya2v@gmail.com" -> "suryav" (glued together,
  // no gap) before the dot/underscore/hyphen split even ran. Now digit
  // runs become a space just like separators do.
  // ------------------------------------------------------------------
  if (email !== "Nil") {
    const emailPrefix = email.split('@')[0];
    const cleanedPrefix = emailPrefix
      .replace(/[0-9]+/g, ' ')      // digits -> space (was: deleted, causing glued words)
      .replace(/[._-]+/g, ' ')      // separators -> space (also collapses repeats, e.g. "..")
      .replace(/\s+/g, ' ')
      .trim();

    if (cleanedPrefix.length > 1) {
      name = cleanedPrefix
        .split(' ')
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    }
  }

  return {
    name: name || "Nil",
    email,
    phone,
    location,
    college: college || "Nil",
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

          if (extractedData.name === "Nil") extractedData.name = file.originalname.split('.')[0];

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