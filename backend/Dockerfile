FROM python:3.11-slim

# Install system dependencies: Tesseract OCR (English + Hindi) and libraries PyMuPDF needs
RUN apt-get update && apt-get install -y \
    tesseract-ocr \
    tesseract-ocr-hin \
    libgl1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Tesseract on Linux is found automatically on PATH, so no special config needed there.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]