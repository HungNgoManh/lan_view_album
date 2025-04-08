// server.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const sharp = require('sharp');
const cors = require('cors');
const { spawn } = require('child_process');

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

// Function to generate video thumbnail using ffmpeg
async function generateVideoThumbnail(videoPath, outputPath) {
    return new Promise((resolve, reject) => {
        // Create ffmpeg command to extract a frame at 1 second
        const ffmpeg = spawn('ffmpeg', [
            '-i', videoPath,             // Input file
            '-ss', '00:00:01',           // Seek to 1 second
            '-frames:v', '1',            // Extract 1 frame
            '-q:v', '2',                 // High quality
            '-vf', 'scale=300:-1',       // Resize to 300px width, keep aspect ratio
            '-y',                        // Overwrite if exists
            outputPath                   // Output file
        ]);

        // Handle process events
        ffmpeg.on('close', (code) => {
            if (code === 0) {
                console.log(`Generated thumbnail for ${path.basename(videoPath)}`);
                resolve(true);
            } else {
                console.error(`FFmpeg process exited with code ${code}`);
                reject(new Error(`FFmpeg process exited with code ${code}`));
            }
        });

        ffmpeg.stderr.on('data', (data) => {
            console.log(`FFmpeg: ${data}`);
        });

        ffmpeg.on('error', (err) => {
            console.error('FFmpeg failed:', err);
            reject(err);
        });
    });
}

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

        // Generate thumbnails based on file type
        if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
            // Handle image thumbnails
            const thumbPath = path.join(THUMB_DIR, originalname);
            await sharp(filePath)
                .resize({ width: 300 })
                .toFile(thumbPath);
        } else if (['.mp4', '.webm', '.mov'].includes(ext)) {
            // Handle video thumbnails
            const thumbPath = path.join(THUMB_DIR, `${originalname}.jpg`);
            try {
                await generateVideoThumbnail(filePath, thumbPath);
                console.log(`Video thumbnail generated for ${originalname}`);
            } catch (thumbErr) {
                console.warn(`Could not generate video thumbnail: ${thumbErr.message}`);
                // Continue even if thumbnail generation fails
            }
        }

        res.json({ success: true, filename: originalname });
    } catch (err) {
        console.error('❌ Upload error:', err);
        res.status(500).json({ success: false, error: err.toString() });
    }
});

// Endpoint to generate video thumbnail on-demand
app.get('/generate-thumbnail/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;
        const videoPath = path.join(UPLOAD_DIR, filename);
        const thumbPath = path.join(THUMB_DIR, `${filename}.jpg`);
        
        // Check if file exists
        if (!await fs.pathExists(videoPath)) {
            return res.status(404).json({ success: false, message: 'Video file not found' });
        }
        
        // Check if thumbnail already exists
        if (await fs.pathExists(thumbPath)) {
            return res.json({ success: true, message: 'Thumbnail already exists', path: `/thumbnails/${filename}.jpg` });
        }
        
        // Generate thumbnail
        await generateVideoThumbnail(videoPath, thumbPath);
        
        res.json({ 
            success: true, 
            message: 'Thumbnail generated successfully',
            path: `/thumbnails/${filename}.jpg`
        });
    } catch (err) {
        console.error('❌ Thumbnail generation error:', err);
        res.status(500).json({ success: false, error: err.toString() });
    }
});

// Get file list
app.get('/uploads', async (req, res) => {
    try {
        const filter = req.query.filter || 'all';
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const checkDuplicates = req.query.checkDuplicates === 'true';
        
        const files = await fs.readdir(UPLOAD_DIR);
        
        // Categorize files
        const fileObjects = await Promise.all(files.map(async filename => {
            const filePath = path.join(UPLOAD_DIR, filename);
            const stats = await fs.stat(filePath);
            const ext = path.extname(filename).toLowerCase();
            
            // Determine file type
            let type = 'other';
            if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
                type = 'image';
            } else if (['.mp4', '.webm', '.mov'].includes(ext)) {
                type = 'video';
            }
            
            return {
                filename,
                size: stats.size,
                modified: stats.mtime,
                type
            };
        }));
        
        // Filter files
        let filteredFiles = fileObjects;
        if (filter === 'image') {
            filteredFiles = fileObjects.filter(file => file.type === 'image');
        } else if (filter === 'video') {
            filteredFiles = fileObjects.filter(file => file.type === 'video');
        } else if (filter === 'other') {
            filteredFiles = fileObjects.filter(file => file.type === 'other');
        }
        
        // Count by type
        const counts = {
            images: fileObjects.filter(file => file.type === 'image').length,
            videos: fileObjects.filter(file => file.type === 'video').length,
            others: fileObjects.filter(file => file.type === 'other').length
        };
        counts.all = counts.images + counts.videos + counts.others;
        
        // For duplicate checking, return all files without pagination
        if (checkDuplicates) {
            return res.json({
                files: filteredFiles,
                counts,
                total: filteredFiles.length
            });
        }
        
        // Pagination
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;
        const paginatedFiles = filteredFiles.slice(startIndex, endIndex);
        
        // Always return a consistent response shape, even if the filtered list is empty
        res.json({
            files: paginatedFiles,
            counts,
            hasMore: endIndex < filteredFiles.length,
            page
        });
    } catch (err) {
        console.error('Error listing files:', err);
        res.status(500).json({ 
            error: 'Failed to list files',
            message: err.message,
            files: [],
            counts: { images: 0, videos: 0, others: 0, all: 0 },
            hasMore: false,
            page: 1
        });
    }
});

// Delete a file
app.delete('/delete/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(UPLOAD_DIR, filename);
        const thumbPath = path.join(THUMB_DIR, filename);
        
        // Remove the file
        await fs.remove(filePath);
        
        // Remove thumbnail if it exists
        try {
            await fs.remove(thumbPath);
        } catch (thumbErr) {
            console.warn(`Could not remove thumbnail for ${filename}:`, thumbErr);
            // Continue even if thumbnail deletion fails
        }
        
        // Get updated file counts
        const remainingFiles = await fs.readdir(UPLOAD_DIR);
        
        // Count files by type
        const counts = {
            images: 0,
            videos: 0,
            others: 0
        };
        
        for (const file of remainingFiles) {
            const ext = path.extname(file).toLowerCase();
            if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
                counts.images++;
            } else if (['.mp4', '.webm', '.mov'].includes(ext)) {
                counts.videos++;
            } else {
                counts.others++;
            }
        }
        
        counts.all = counts.images + counts.videos + counts.others;
        
        res.json({ 
            success: true, 
            message: `File ${filename} deleted successfully`,
            counts
        });
    } catch (err) {
        console.error('❌ Delete error:', err);
        res.status(500).json({ 
            success: false, 
            error: err.toString() 
        });
    }
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
