// server.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const sharp = require('sharp');
const cors = require('cors');

const app = express();
const PORT = 3000;

const UPLOAD_DIR = path.join(__dirname, 'public/uploads');
const THUMB_DIR = path.join(__dirname, 'public/thumbnails');

// Ensure upload folders exist
fs.ensureDirSync(UPLOAD_DIR);
fs.ensureDirSync(THUMB_DIR);

app.use(cors());
app.use(express.static('public'));
app.use(express.json());

// Configure multer for disk storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${file.originalname}`;
        cb(null, uniqueName);
    }
});
const upload = multer({ storage });

// Upload route
app.post('/upload', upload.single('file'), async (req, res) => {
    try {
        const { originalname } = req.file;
        const existingFiles = await fs.readdir(UPLOAD_DIR);

        // Check for duplicate file
        if (existingFiles.includes(originalname)) {
            return res.status(400).json({ success: false, message: 'File already exists.' });
        }

        const filePath = path.join(UPLOAD_DIR, originalname);

        // Move file to the correct location
        await fs.move(req.file.path, filePath);

        const ext = path.extname(originalname).toLowerCase();

        // Only generate thumbnails for images
        if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
            const thumbPath = path.join(THUMB_DIR, originalname);
            await sharp(filePath)
                .resize({ width: 300 })
                .toFile(thumbPath);
        }

        res.json({ success: true, filename: originalname });
    } catch (err) {
        console.error('❌ Upload error:', err);
        res.status(500).json({ success: false, error: err.toString() });
    }
});

// Get file list
app.get('/uploads', async (req, res) => {
    const files = await fs.readdir(UPLOAD_DIR);
    res.json(files);
});

// Delete a file
app.delete('/delete/:filename', async (req, res) => {
    const filename = req.params.filename;
    await fs.remove(path.join(UPLOAD_DIR, filename));
    await fs.remove(path.join(THUMB_DIR, filename));
    res.json({ success: true });
});

// Rename a file
app.post('/rename', async (req, res) => {
    const { oldName, newName } = req.body;
    const oldPath = path.join(UPLOAD_DIR, oldName);
    const newPath = path.join(UPLOAD_DIR, newName);

    await fs.rename(oldPath, newPath);

    const oldThumb = path.join(THUMB_DIR, oldName);
    const newThumb = path.join(THUMB_DIR, newName);
    if (await fs.pathExists(oldThumb)) {
        await fs.rename(oldThumb, newThumb);
    }

    res.json({ success: true });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});
