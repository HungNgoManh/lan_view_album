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

        // Generate thumbnails for images and videos during upload
        if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) {
            // For images
            const thumbPath = path.join(THUMB_DIR, originalname);
            await sharp(filePath)
                .resize({ width: 300, height: 300, fit: 'cover' })
                .toFile(thumbPath);
                
            console.log(`Generated thumbnail for image: ${originalname}`);
        } else if (['.mp4', '.webm', '.mov'].includes(ext)) {
            // For videos - in a production environment, you would use ffmpeg
            // For this example, we'll create a placeholder
            try {
                const thumbPath = path.join(THUMB_DIR, `${path.basename(originalname, ext)}.jpg`);
                
                // Create a video placeholder thumbnail
                await sharp({
                    create: {
                        width: 300,
                        height: 300,
                        channels: 4,
                        background: { r: 0, g: 0, b: 0, alpha: 0.8 }
                    }
                })
                .composite([{
                    input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="#ffffff"/></svg>'),
                    gravity: 'center'
                }])
                .jpeg()
                .toFile(thumbPath);
                
                console.log(`Generated placeholder thumbnail for video: ${originalname}`);
            } catch (thumbErr) {
                console.error('Error generating video thumbnail:', thumbErr);
                // Continue even if thumbnail generation fails
            }
        }

        res.json({ success: true, filename: originalname });
    } catch (err) {
        console.error('❌ Upload error:', err);
        res.status(500).json({ success: false, error: err.toString() });
    }
});

// Get file list
app.get('/uploads', async (req, res) => {
    try {
        const filter = req.query.filter || 'all';
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        
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
        const ext = path.extname(filename).toLowerCase();
        
        console.log(`Delete request for file: ${filename}`);
        
        // Check if file exists before deleting
        if (!await fs.pathExists(filePath)) {
            console.warn(`File not found for deletion: ${filePath}`);
            return res.status(404).json({
                success: false,
                message: 'File not found'
            });
        }
        
        // Remove the file
        await fs.remove(filePath);
        console.log(`Deleted file: ${filePath}`);
        
        // Remove thumbnail based on file type
        try {
            let thumbPath;
            
            if (['.mp4', '.webm', '.mov'].includes(ext)) {
                // For videos, the thumbnail is named differently (base name + jpg)
                const baseName = path.basename(filename, ext);
                thumbPath = path.join(THUMB_DIR, `${baseName}.jpg`);
            } else {
                // For other files, use the same filename
                thumbPath = path.join(THUMB_DIR, filename);
            }
            
            if (await fs.pathExists(thumbPath)) {
                await fs.remove(thumbPath);
                console.log(`Deleted thumbnail: ${thumbPath}`);
            } else {
                console.log(`No thumbnail found at ${thumbPath}`);
            }
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

// Get a thumbnail 
app.get('/thumbnail/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;
        const ext = path.extname(filename).toLowerCase();
        let thumbPath;
        
        // For videos, look for the JPG thumbnail
        if (['.mp4', '.webm', '.mov'].includes(ext)) {
            // Extract the basename without extension and add .jpg
            const baseName = path.basename(filename, ext);
            thumbPath = path.join(THUMB_DIR, `${baseName}.jpg`);
        } else {
            // For other files, use the same filename
            thumbPath = path.join(THUMB_DIR, filename);
        }
        
        // Check if thumbnail exists
        if (await fs.pathExists(thumbPath)) {
            res.sendFile(thumbPath);
        } else {
            // If no thumbnail exists, create a placeholder SVG
            const placeholderSvg = `
                <svg width="300" height="300" xmlns="http://www.w3.org/2000/svg">
                    <rect width="100%" height="100%" fill="#f0f0f0"/>
                    <text x="50%" y="50%" font-family="Arial" font-size="24" fill="#999" text-anchor="middle">No Preview</text>
                </svg>
            `;
            res.setHeader('Content-Type', 'image/svg+xml');
            res.send(placeholderSvg);
        }
    } catch (err) {
        console.error('Thumbnail error:', err);
        res.status(500).send('Error getting thumbnail');
    }
});

// Generate a thumbnail on demand
app.post('/generate-thumbnail/:filename', (req, res) => {
    const filename = req.params.filename;
    
    // Sanitize the filename to avoid path traversal
    const sanitizedFilename = path.basename(filename);
    const filePath = path.join(__dirname, 'public', 'uploads', sanitizedFilename);
    const fileExt = path.extname(sanitizedFilename).toLowerCase();
    const baseName = path.basename(sanitizedFilename, fileExt);
    const thumbnailPath = path.join(__dirname, 'public', 'thumbnails', `${baseName}.jpg`);
    const relativeThumbnailPath = `/thumbnails/${baseName}.jpg`;
    
    console.log(`[Thumbnail Generation] Request for: ${sanitizedFilename}`);
    console.log(`[Thumbnail Generation] File path: ${filePath}`);
    console.log(`[Thumbnail Generation] Thumbnail path: ${thumbnailPath}`);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
        console.error(`[Thumbnail Generation] File not found: ${filePath}`);
        return res.status(404).json({ success: false, error: 'File not found' });
    }
    
    // Check if thumbnail already exists
    if (fs.existsSync(thumbnailPath)) {
        console.log(`[Thumbnail Generation] Thumbnail exists, regenerating: ${thumbnailPath}`);
        try {
            // Delete existing thumbnail to ensure we generate a fresh one
            fs.unlinkSync(thumbnailPath);
            console.log(`[Thumbnail Generation] Deleted existing thumbnail: ${thumbnailPath}`);
        } catch (err) {
            console.error(`[Thumbnail Generation] Error deleting existing thumbnail:`, err);
            // Continue even if we can't delete (will overwrite)
        }
    }

    // Generate thumbnail based on file type
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(fileExt)) {
        // For images
        try {
            console.log(`[Thumbnail Generation] Processing image: ${sanitizedFilename}`);
            
            sharp(filePath)
                .resize(300, 225, { fit: 'inside', withoutEnlargement: true })
                .toFile(thumbnailPath)
                .then(() => {
                    console.log(`[Thumbnail Generation] Image thumbnail created: ${thumbnailPath}`);
                    res.json({ success: true, thumbnail: relativeThumbnailPath });
                })
                .catch(err => {
                    console.error(`[Thumbnail Generation] Error creating image thumbnail:`, err);
                    res.status(500).json({ success: false, error: 'Error creating thumbnail' });
                });
        } catch (err) {
            console.error(`[Thumbnail Generation] Sharp error processing image:`, err);
            res.status(500).json({ success: false, error: 'Error processing image' });
        }
    } else if (['.mp4', '.webm', '.mov', '.avi', '.mkv'].includes(fileExt)) {
        // For videos
        console.log(`[Thumbnail Generation] Processing video: ${sanitizedFilename}`);
        
        // Ensure thumbnails directory exists
        if (!fs.existsSync(path.dirname(thumbnailPath))) {
            fs.mkdirSync(path.dirname(thumbnailPath), { recursive: true });
            console.log(`[Thumbnail Generation] Created thumbnails directory: ${path.dirname(thumbnailPath)}`);
        }
        
        try {
            // Generate the thumbnail from the video using ffmpeg
            const ffmpeg = spawn('ffmpeg', [
                '-i', filePath,
                '-ss', '00:00:01',  // Take frame from 1 second in
                '-vframes', '1',
                '-vf', 'scale=300:-1',  // Resize to width 300px, maintain aspect ratio
                thumbnailPath
            ]);
            
            ffmpeg.stdout.on('data', (data) => {
                console.log(`[Thumbnail Generation] FFmpeg stdout: ${data}`);
            });
            
            ffmpeg.stderr.on('data', (data) => {
                console.log(`[Thumbnail Generation] FFmpeg stderr: ${data}`);
            });
            
            ffmpeg.on('close', (code) => {
                if (code === 0) {
                    console.log(`[Thumbnail Generation] Video thumbnail created: ${thumbnailPath}`);
                    
                    // Verify the thumbnail was actually created
                    if (fs.existsSync(thumbnailPath)) {
                        const stats = fs.statSync(thumbnailPath);
                        console.log(`[Thumbnail Generation] Created thumbnail size: ${stats.size} bytes`);
                        
                        if (stats.size > 0) {
                            res.json({ success: true, thumbnail: relativeThumbnailPath });
                        } else {
                            console.error(`[Thumbnail Generation] Created thumbnail has zero size`);
                            res.status(500).json({ success: false, error: 'Thumbnail has zero size' });
                        }
                    } else {
                        console.error(`[Thumbnail Generation] FFmpeg reported success but thumbnail not found`);
                        res.status(500).json({ success: false, error: 'Thumbnail not found after generation' });
                    }
                } else {
                    console.error(`[Thumbnail Generation] FFmpeg process exited with code ${code}`);
                    res.status(500).json({ success: false, error: `FFmpeg exited with code ${code}` });
                }
            });
            
            ffmpeg.on('error', (err) => {
                console.error(`[Thumbnail Generation] FFmpeg process error:`, err);
                res.status(500).json({ success: false, error: 'FFmpeg process error' });
            });
        } catch (err) {
            console.error(`[Thumbnail Generation] Error generating video thumbnail:`, err);
            res.status(500).json({ success: false, error: 'Error generating video thumbnail' });
        }
    } else {
        console.error(`[Thumbnail Generation] Unsupported file type: ${fileExt}`);
        res.status(400).json({ success: false, error: 'Unsupported file type' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});
