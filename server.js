const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');
const sharp = require('sharp');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer config
const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'pdf' && file.mimetype !== 'application/pdf') {
      return cb(new Error('Hanya file PDF yang diperbolehkan'));
    }
    if (file.fieldname === 'signature' && !file.mimetype.startsWith('image/')) {
      return cb(new Error('Hanya file gambar yang diperbolehkan untuk tanda tangan'));
    }
    cb(null, true);
  }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '50mb' }));

// Upload PDF endpoint
app.post('/api/upload-pdf', upload.single('pdf'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Tidak ada file PDF yang diupload' });
  }
  res.json({
    filename: req.file.filename,
    originalName: req.file.originalname,
    size: req.file.size
  });
});

// Get PDF for preview
app.get('/api/pdf/:filename', (req, res) => {
  const filePath = path.join(uploadsDir, req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File tidak ditemukan' });
  }
  res.sendFile(filePath);
});

// Sign PDF endpoint
app.post('/api/sign-pdf', upload.single('signature'), async (req, res) => {
  try {
    const { pdfFilename, signatures: signaturesJson } = req.body;
    let signatureImageBytes;

    // Handle signature from file upload or base64 data
    if (req.file) {
      signatureImageBytes = fs.readFileSync(req.file.path);
    } else if (req.body.signatureData) {
      const base64Data = req.body.signatureData.replace(/^data:image\/\w+;base64,/, '');
      signatureImageBytes = Buffer.from(base64Data, 'base64');
    } else {
      return res.status(400).json({ error: 'Tidak ada tanda tangan yang diberikan' });
    }

    // Convert signature to PNG using sharp (handles transparency)
    const pngSignatureBytes = await sharp(signatureImageBytes)
      .png()
      .toBuffer();

    const pdfPath = path.join(uploadsDir, pdfFilename);
    if (!fs.existsSync(pdfPath)) {
      return res.status(404).json({ error: 'File PDF tidak ditemukan' });
    }

    const pdfBytes = fs.readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pngImage = await pdfDoc.embedPng(pngSignatureBytes);

    // Parse signatures placement data
    const signatures = JSON.parse(signaturesJson);

    for (const sig of signatures) {
      const page = pdfDoc.getPage(sig.page);
      const { width: pageWidth, height: pageHeight } = page.getSize();

      // Convert from preview coordinates to PDF coordinates
      const pdfX = (sig.x / sig.previewWidth) * pageWidth;
      const pdfY = pageHeight - (sig.y / sig.previewHeight) * pageHeight - (sig.height / sig.previewHeight) * pageHeight;
      const pdfWidth = (sig.width / sig.previewWidth) * pageWidth;
      const pdfHeight = (sig.height / sig.previewHeight) * pageHeight;

      page.drawImage(pngImage, {
        x: pdfX,
        y: pdfY,
        width: pdfWidth,
        height: pdfHeight,
        opacity: sig.opacity !== undefined ? sig.opacity : 1.0
      });
    }

    const signedPdfBytes = await pdfDoc.save();
    const signedFilename = `signed-${Date.now()}.pdf`;
    const signedPath = path.join(uploadsDir, signedFilename);
    fs.writeFileSync(signedPath, signedPdfBytes);

    // Clean up uploaded signature file
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }

    res.json({ filename: signedFilename });
  } catch (err) {
    console.error('Error signing PDF:', err);
    res.status(500).json({ error: 'Gagal menandatangani PDF: ' + err.message });
  }
});

// Download signed PDF
app.get('/api/download/:filename', (req, res) => {
  const filePath = path.join(uploadsDir, req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File tidak ditemukan' });
  }
  res.download(filePath, `signed-document.pdf`);
});

// Error handling for multer
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Ukuran file terlalu besar (maks 50MB)' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});
