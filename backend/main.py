"""
LegalGuard AI — Backend Server
Run with: uvicorn main:app --reload --port 8000
"""

import io
import os
import uuid
from datetime import datetime, timezone

import fitz  # PyMuPDF
import pytesseract
from PIL import Image
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from pymongo import MongoClient, DESCENDING
from dotenv import load_dotenv

from analyzer import analyze_document, llm_available

load_dotenv()

# ---- Tesseract path (Windows) ----
import platform
if platform.system() == "Windows":
    pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
# ---- MongoDB setup (cloud Atlas or local fallback) ----
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
mongo_client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
db = mongo_client["legalguard_ai"]
history_collection = db["analysis_history"]


def mongo_available() -> bool:
    try:
        mongo_client.admin.command("ping")
        return True
    except Exception:
        return False


app = FastAPI(title="LegalGuard AI")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def extract_text_from_pdf(file_bytes: bytes) -> str:
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    all_text = []

    for page in doc:
        page_text = page.get_text().strip()
        if len(page_text) > 20:
            all_text.append(page_text)
        else:
            pix = page.get_pixmap(dpi=300)
            img_bytes = pix.tobytes("png")
            img = Image.open(io.BytesIO(img_bytes))
            ocr_text = pytesseract.image_to_string(img, lang="eng+hin")
            all_text.append(ocr_text)

    doc.close()
    return "\n".join(all_text)


def extract_text_from_image(file_bytes: bytes) -> str:
    img = Image.open(io.BytesIO(file_bytes))
    return pytesseract.image_to_string(img, lang="eng+hin")


def save_to_history(source_name: str, result: dict) -> str:
    if not mongo_available():
        return ""
    record = {
        "_id": str(uuid.uuid4()),
        "source_name": source_name,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "risk_score": result["risk_score"],
        "risk_level": result["risk_level"],
        "clause_count": result["clause_count"],
        "detected_language": result["detected_language"],
        "output_language": result["output_language"],
        "clauses": result["clauses"],
    }
    history_collection.insert_one(record)
    return record["_id"]


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "llm_available": llm_available(),
        "mongo_available": mongo_available(),
        "mongo_uri_preview": MONGO_URI[:40] if MONGO_URI else "NOT SET",
    }


@app.post("/api/analyze")
async def analyze(file: UploadFile = File(...), output_language: str = Form("English")):
    filename = file.filename or "uploaded_document"
    content = await file.read()
    lower_name = filename.lower()

    if lower_name.endswith(".pdf"):
        try:
            text = extract_text_from_pdf(content)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Could not parse PDF: {e}")
    elif lower_name.endswith(".txt"):
        text = content.decode("utf-8", errors="ignore")
    elif lower_name.endswith((".png", ".jpg", ".jpeg", ".bmp", ".tiff")):
        try:
            text = extract_text_from_image(content)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Could not read image: {e}")
    else:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Upload a .pdf, .txt, or image (.png/.jpg) file.",
        )

    text = text.strip()
    if not text or len(text) < 50:
        raise HTTPException(status_code=400, detail="No readable text found in the document.")

    result = analyze_document(text, output_language=output_language)
    history_id = save_to_history(filename, result)
    result["history_id"] = history_id
    return result


class TextPayload(BaseModel):
    text: str
    output_language: str = "English"


@app.post("/api/analyze-text")
async def analyze_text(payload: TextPayload):
    text = payload.text.strip()
    if not text or len(text) < 50:
        raise HTTPException(status_code=400, detail="Please provide at least a few sentences of agreement text.")

    result = analyze_document(text, output_language=payload.output_language)
    history_id = save_to_history("Pasted Text", result)
    result["history_id"] = history_id
    return result


@app.get("/api/history")
def get_history():
    if not mongo_available():
        return {"available": False, "records": []}

    records = list(
        history_collection.find(
            {},
            {"clauses": 0},
        ).sort("timestamp", DESCENDING).limit(50)
    )
    return {"available": True, "records": records}


@app.get("/api/history/{record_id}")
def get_history_detail(record_id: str):
    if not mongo_available():
        raise HTTPException(status_code=503, detail="Database not available.")

    record = history_collection.find_one({"_id": record_id})
    if not record:
        raise HTTPException(status_code=404, detail="Record not found.")
    return record


# Serve the frontend (index.html, css, js) — must be mounted LAST
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")