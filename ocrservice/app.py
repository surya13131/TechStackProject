from fastapi import FastAPI, UploadFile, File, HTTPException
from paddleocr import PaddleOCR
import os
import uuid

app = FastAPI()

# Initialize PaddleOCR
ocr = PaddleOCR(use_angle_cls=True, lang="en")

@app.post("/ocr")
async def extract_text(file: UploadFile = File(...)):
    # Create a unique temporary file name to prevent concurrent upload collisions
    temp_filename = f"temp_{uuid.uuid4().hex}.png"
    
    try:
        # Read the file sent from Node.js over HTTP
        contents = await file.read()
        
        # Save it to Python's local isolated filesystem
        with open(temp_filename, "wb") as f:
            f.write(contents)

        # Run OCR
        result = ocr.ocr(temp_filename)

        # Delete the temp file immediately to save disk space
        os.remove(temp_filename)

        # Extract text
        extracted_text = []
        if result and result[0]:
            for page in result:
                for line in page:
                    extracted_text.append(line[1][0])

        return {"text": "\n".join(extracted_text)}

    except Exception as e:
        # Safety net: Ensure the temp file is deleted even if the OCR crashes
        if os.path.exists(temp_filename):
            os.remove(temp_filename)
        raise HTTPException(status_code=500, detail=str(e))