// Uppy setup
const uppy = new Uppy.Uppy({ restrictions: { maxNumberOfFiles: 1000 } })
    .use(Uppy.Dashboard, {
        inline: true,
        target: '#drag-drop-area',
        showProgressDetails: true,
        proudlyDisplayPoweredByUppy: false,
        note: 'Images, Videos, Audios, Documents supported',
        height: 300,
        hideUploadButton: false,
        hideProgressAfterFinish: true,
        showLinkToFileUploadResult: false,
        showRemoveButtonAfterComplete: true,
        thumbnailWidth: false,
        showSelectedFiles: true,
        showSelectedFilesPanel: true
    })
    .use(Uppy.XHRUpload, {
        endpoint: '/upload',
        fieldName: 'file',
        bundle: false
    });

uppy.on('file-added', async (file) => {
    console.log(`Added file: ${file.name} (${file.size} bytes)`);

    // Check for duplicate files
    const response = await fetch('/uploads');
    const existingFiles = await response.json();

    if (existingFiles.includes(file.name)) {
        // Show toast message
        const toastEl = document.getElementById('uploadToast');
        const toast = new bootstrap.Toast(toastEl);
        document.getElementById('toastMessage').textContent = `❌ File "${file.name}" already exists.`;
        toast.show();
        
        // Remove the duplicate file
        uppy.removeFile(file.id);
    }
});

uppy.on('upload-success', (file, response) => {
    console.log(`File ${file.name} uploaded successfully`);
});

uppy.on('upload-error', (file, error, response) => {
    console.error(`Error uploading ${file.name}:`, error);
    alert(`❌ Upload failed for "${file.name}": ${error}`);
});

uppy.on('complete', (result) => {
    if (result.successful.length > 0) {
        // Show toast message for successful upload
        const toastEl = document.getElementById('uploadToast');
        const toast = new bootstrap.Toast(toastEl);
        document.getElementById('toastMessage').textContent = '✅ Upload complete!';
        toast.show();

        loadGallery();
        
        // Clear all files from Uppy Dashboard
        uppy.cancelAll();
        // Remove all files from Uppy's internal state
        const files = uppy.getFiles();
        files.forEach(file => uppy.removeFile(file.id));
        
        // Switch to the View tab
        const viewTab = new bootstrap.Tab(document.querySelector('#view-tab'));
        viewTab.show();
    }
});

// Add this function to get video duration
function getVideoDuration(videoUrl) {
    return new Promise((resolve) => {
        const video = document.createElement('video');
        video.src = videoUrl;
        video.preload = 'metadata';
        video.onloadedmetadata = () => {
            const duration = Math.round(video.duration);
            const minutes = Math.floor(duration / 60);
            const seconds = duration % 60;
            resolve(`${minutes}:${seconds.toString().padStart(2, '0')}`);
        };
    });
}

function createImageThumbnail(url) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous'; // Handle CORS if necessary
        img.onload = function() {
            const canvas = document.createElement('canvas');
            // Reduce thumbnail size to save storage space
            const maxSize = 300;
            const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
            canvas.width = img.width * scale;
            canvas.height = img.height * scale;
            const context = canvas.getContext('2d');
            context.drawImage(img, 0, 0, canvas.width, canvas.height);
            const dataURL = canvas.toDataURL('image/jpeg', 0.7); // Use JPEG with compression
            resolve(dataURL);
        };
        img.src = url;
    });
}

// Add this function to handle URL parameters
function getUrlParameter(name) {
    name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
    const regex = new RegExp('[\\?&]' + name + '=([^&#]*)');
    const results = regex.exec(location.search);
    return results === null ? '' : decodeURIComponent(results[1].replace(/\+/g, ' '));
}

// Update the loadGallery function to handle URL parameters
function loadGallery(filter = null) {
    // Show loading spinner if it exists
    const loadingSpinner = document.getElementById('loadingSpinner');
    if (loadingSpinner) {
        loadingSpinner.classList.remove('d-none');
    }

    // If no filter is provided, try to get it from URL
    if (!filter) {
        filter = getUrlParameter('filter') || 'all';
    }

    // Update URL without reloading the page
    const newUrl = new URL(window.location);
    if (filter === 'all') {
        newUrl.searchParams.delete('filter');
    } else {
        newUrl.searchParams.set('filter', filter);
    }
    window.history.pushState({}, '', newUrl);

    fetch('/uploads')
        .then(res => res.json())
        .then(async files => {
            const gallery = document.getElementById('gallery');
            if (!gallery) return; // Exit if gallery not found
            
            gallery.innerHTML = '';
            
            // Create a document fragment for better performance
            const fragment = document.createDocumentFragment();
            
            const filesWithDates = await Promise.all(files.map(async file => {
                const url = `/uploads/${file}`;
                const response = await fetch(url, { method: 'HEAD' });
                const lastModified = new Date(response.headers.get('last-modified'));
                return { file, date: lastModified };
            }));

            // Sort files by date in descending order
            filesWithDates.sort((a, b) => b.date - a.date);
            
            for (const {file} of filesWithDates) {
                const ext = file.split('.').pop().toLowerCase();
                const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
                const isVideo = ['mp4', 'webm', 'mov'].includes(ext);
                const url = `/uploads/${file}`;

                if (filter === 'image' && !isImage) continue;
                if (filter === 'video' && !isVideo) continue;
                if (filter === 'other' && (isImage || isVideo)) continue;

                let media;
                if (isImage) {
                    try {
                        // Check if thumbnail exists in cache
                        const cachedThumbnail = localStorage.getItem(`img_thumb_${file}`);
                        
                        if (cachedThumbnail) {
                            // Use cached thumbnail
                            media = `<img src="${cachedThumbnail}" class="card-img-top" loading="lazy" onclick="showImageModal('${url}')">`;
                            const col = document.createElement('div');
                            col.className = 'col-3 mb-3';
                            col.innerHTML = `
                                <div class="card h-100">
                                    ${media}
                                </div>`;
                            fragment.appendChild(col);
                        } else {
                            // Generate new thumbnail and cache it
                            const thumbnail = await createImageThumbnail(url);
                            try {
                                localStorage.setItem(`img_thumb_${file}`, thumbnail);
                            } catch (e) {
                                // If storage is full, clear old thumbnails and try again
                                if (e.name === 'QuotaExceededError') {
                                    clearOldThumbnails();
                                    try {
                                        localStorage.setItem(`img_thumb_${file}`, thumbnail);
                                    } catch (e2) {
                                        console.warn('Failed to cache image thumbnail:', e2);
                                    }
                                }
                            }
                            
                            media = `<img src="${thumbnail}" class="card-img-top" loading="lazy" onclick="showImageModal('${url}')">`;
                            const col = document.createElement('div');
                            col.className = 'col-3 mb-3';
                            col.innerHTML = `
                                <div class="card h-100">
                                    ${media}
                                </div>`;
                            fragment.appendChild(col);
                        }
                    } catch (e) {
                        console.warn('Error handling image thumbnail:', e);
                        // Fallback to original image
                        media = `<img src="${url}" class="card-img-top" loading="lazy" onclick="showImageModal('${url}')">`;
                        const col = document.createElement('div');
                        col.className = 'col-3 mb-3';
                        col.innerHTML = `
                            <div class="card h-100">
                                ${media}
                            </div>`;
                        fragment.appendChild(col);
                    }
                } else if (isVideo) {
                    try {
                        // Check if thumbnail exists in cache
                        const cachedThumbnail = localStorage.getItem(`thumb_${file}`);
                        const cachedDuration = localStorage.getItem(`duration_${file}`);
                        
                        if (cachedThumbnail && cachedDuration) {
                            // Use cached thumbnail and duration
                            media = `
                                <div class="position-relative">
                                    <img src="${cachedThumbnail}" class="card-img-top" onclick="showImageModal('${url}')">
                                    <span class="position-absolute bottom-0 end-0 badge bg-dark m-2">
                                        ${cachedDuration}
                                    </span>
                                </div>`;
                            const col = document.createElement('div');
                            col.className = 'col-3 mb-3';
                            col.innerHTML = `
                                <div class="card h-100">
                                    ${media}
                                </div>`;
                            fragment.appendChild(col);
                        } else {
                            // Generate new thumbnail and cache it
                            captureVideoFrame(url, function(thumbnail, duration) {
                                try {
                                    // Try to cache the thumbnail and duration
                                    localStorage.setItem(`thumb_${file}`, thumbnail);
                                    localStorage.setItem(`duration_${file}`, duration);
                                } catch (e) {
                                    // If storage is full, clear old thumbnails and try again
                                    if (e.name === 'QuotaExceededError') {
                                        clearOldThumbnails();
                                        try {
                                            localStorage.setItem(`thumb_${file}`, thumbnail);
                                            localStorage.setItem(`duration_${file}`, duration);
                                        } catch (e2) {
                                            console.warn('Failed to cache thumbnail:', e2);
                                        }
                                    }
                                }
                                
                                media = `
                                    <div class="position-relative">
                                        <img src="${thumbnail}" class="card-img-top" onclick="showImageModal('${url}')">
                                        <span class="position-absolute bottom-0 end-0 badge bg-dark m-2">
                                            ${duration}
                                        </span>
                                    </div>`;
                                const col = document.createElement('div');
                                col.className = 'col-3 mb-3';
                                col.innerHTML = `
                                    <div class="card h-100">
                                        ${media}
                                    </div>`;
                                fragment.appendChild(col);
                                gallery.appendChild(fragment);
                            });
                        }
                    } catch (e) {
                        console.warn('Error handling video thumbnail:', e);
                        // Fallback to basic video display without thumbnail
                        media = `
                            <div class="position-relative">
                                <div class="card-img-top bg-dark text-white d-flex align-items-center justify-content-center" style="height: 200px;">
                                    <i class="bi bi-play-circle-fill" style="font-size: 2rem;"></i>
                                </div>
                            </div>`;
                        const col = document.createElement('div');
                        col.className = 'col-3 mb-3';
                        col.innerHTML = `
                            <div class="card h-100">
                                ${media}
                            </div>`;
                        fragment.appendChild(col);
                    }
                } else {
                    media = `<div class="card-body text-center">
                        <div class="small text-muted mb-2">${file}</div>
                        <a href="${url}" download class="btn btn-primary btn-sm">
                            <i class="bi bi-download"></i> Download
                        </a>
                    </div>`;
                    const col = document.createElement('div');
                    col.className = 'col-3 mb-3';
                    col.innerHTML = `
                        <div class="card h-100">
                            ${media}
                        </div>`;
                    fragment.appendChild(col);
                }
            }
            
            // Append the fragment to the gallery
            gallery.appendChild(fragment);

            // Update filter buttons to match current filter
            const filterButtons = document.querySelectorAll('.btn-filter');
            filterButtons.forEach(button => {
                if (button.dataset.filter === filter) {
                    button.classList.add('active');
                } else {
                    button.classList.remove('active');
                }
            });
        })
        .finally(() => {
            // Hide loading spinner if it exists
            if (loadingSpinner) {
                loadingSpinner.classList.add('d-none');
            }
            // Re-enable filter buttons
            const filterButtons = document.querySelectorAll('.btn-filter');
            filterButtons.forEach(btn => btn.disabled = false);
        });
}

function deleteFile(file) {
    if (confirm('🗑️ Are you sure you want to delete this file?')) {
        fetch(`/delete/${file}`, { method: 'DELETE' })
            .then(() => loadGallery());
    }
}

function renameFilePrompt(oldName) {
    const newName = prompt('Enter new filename (with extension):', oldName);
    if (newName && newName !== oldName) {
        fetch('/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldName, newName })
        }).then(() => loadGallery());
    }
}

function showImageModal(selectedUrl) {
    const ext = selectedUrl.split('.').pop().toLowerCase();
    const isVideo = ['mp4', 'webm', 'mov'].includes(ext);

    if (isVideo) {
        // Show video in modal
        const carouselVideos = document.getElementById('carouselVideos');
        carouselVideos.innerHTML = ''; // Clear existing videos

        fetch('/uploads')
            .then(res => res.json())
            .then(files => {
                files.forEach((file) => {
                    const fileExt = file.split('.').pop().toLowerCase();
                    const isVideoFile = ['mp4', 'webm', 'mov'].includes(fileExt);
                    const url = `/uploads/${file}`;

                    if (isVideoFile) {
                        const activeClass = url === selectedUrl ? 'active' : '';
                        const carouselItem = document.createElement('div');
                        carouselItem.className = `carousel-item ${activeClass}`;
                        const video = document.createElement('video');
                        video.src = url;
                        video.className = 'd-block w-100';
                        video.controls = true;
                        if (activeClass) video.autoplay = true;
                        carouselItem.appendChild(video);
                        carouselVideos.appendChild(carouselItem);
                    }
                });
            });

        const videoModal = new bootstrap.Modal(document.getElementById('videoModal'));
        videoModal.show();
    } else {
        // Handle images in the modal with carousel
        const carouselImages = document.getElementById('carouselImages');
        carouselImages.innerHTML = ''; // Clear existing images

        fetch('/uploads')
            .then(res => res.json())
            .then(files => {
                files.reverse().forEach((file) => {
                    const fileExt = file.split('.').pop().toLowerCase();
                    const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(fileExt);
                    const url = `/uploads/${file}`;

                    const activeClass = url === selectedUrl ? 'active' : '';

                    if (isImage) {
                        carouselImages.insertAdjacentHTML('beforeend', `
                            <div class="carousel-item ${activeClass}">
                                <img src="${url}" class="d-block w-100" alt="...">
                            </div>
                        `);
                    }
                });

                // Add keydown event listener for navigation
                document.addEventListener('keydown', handleKeydown);
            });

        const imageModal = new bootstrap.Modal(document.getElementById('imageModal'));
        imageModal.show();

        // Remove event listener when modal is closed
        document.getElementById('imageModal').addEventListener('hidden.bs.modal', () => {
            document.removeEventListener('keydown', handleKeydown);
        });
    }
}

function handleKeydown(event) {
    if (event.key === 'ArrowLeft') {
        document.querySelector('.carousel-control-prev').click();
    } else if (event.key === 'ArrowRight') {
        document.querySelector('.carousel-control-next').click();
    }
}

// Update the event listeners for filter buttons
document.addEventListener('DOMContentLoaded', function() {
    const filterButtons = document.querySelectorAll('.btn-filter');
    filterButtons.forEach(button => {
        button.addEventListener('click', function() {
            // Disable all filter buttons while loading
            filterButtons.forEach(btn => btn.disabled = true);
            
            // Remove active class from all buttons
            filterButtons.forEach(btn => btn.classList.remove('active'));
            // Add active class to clicked button
            this.classList.add('active');
            // Apply filter
            loadGallery(this.dataset.filter);
        });
    });

    // Load gallery with filter from URL on page load
    const filter = getUrlParameter('filter') || 'all';
    loadGallery(filter);

    const videoModalElement = document.getElementById('videoModal');
    const videoModal = new bootstrap.Modal(videoModalElement);

    videoModalElement.addEventListener('hidden.bs.modal', function () {
        const video = videoModalElement.querySelector('video');
        if (video) {
            video.pause();
            video.currentTime = 0; // Reset the video to the start
        }
    });
});

function captureVideoFrame(url, callback) {
    const video = document.createElement('video');
    video.src = url;
    video.crossOrigin = 'anonymous'; // Handle CORS if necessary
    video.addEventListener('loadeddata', function() {
        video.currentTime = 0; // Seek to the first frame
    });

    video.addEventListener('seeked', function() {
        const canvas = document.createElement('canvas');
        // Reduce thumbnail size to save storage space
        const maxSize = 300;
        const scale = Math.min(1, maxSize / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = video.videoWidth * scale;
        canvas.height = video.videoHeight * scale;
        const context = canvas.getContext('2d');
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataURL = canvas.toDataURL('image/jpeg', 0.7); // Use JPEG with compression
        const duration = Math.round(video.duration);
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;
        callback(dataURL, `${minutes}:${seconds.toString().padStart(2, '0')}`);
    });

    video.load(); // Ensure the video is loaded
}

// Update clearOldThumbnails to handle both image and video thumbnails
function clearOldThumbnails() {
    const keys = Object.keys(localStorage);
    const thumbnailKeys = keys.filter(key => key.startsWith('thumb_') || key.startsWith('img_thumb_'));
    const durationKeys = keys.filter(key => key.startsWith('duration_'));
    
    // Remove oldest 50% of thumbnails
    const removeCount = Math.floor(thumbnailKeys.length / 2);
    for (let i = 0; i < removeCount; i++) {
        localStorage.removeItem(thumbnailKeys[i]);
        if (durationKeys[i]) {
            localStorage.removeItem(durationKeys[i]);
        }
    }
}

function createFileCard(file) {
    const card = document.createElement('div');
    card.className = 'col';

    const cardDiv = document.createElement('div');
    cardDiv.className = 'card h-100';

    const cardBody = document.createElement('div');
    cardBody.className = 'card-body p-0';

    let mediaElement;
    if (file.type.startsWith('image/')) {
        mediaElement = document.createElement('img');
        mediaElement.src = file.url;
        mediaElement.className = 'card-img-top';
        mediaElement.onclick = () => showImageModal(file);
    } else if (file.type.startsWith('video/')) {
        captureVideoFrame(file.url, function(thumbnail) {
            mediaElement = document.createElement('img');
            mediaElement.src = thumbnail;
            mediaElement.className = 'card-img-top';
            mediaElement.onclick = () => showImageModal(file);
            cardBody.appendChild(mediaElement);
        });
        // Add play icon overlay
        const playIcon = document.createElement('div');
        playIcon.className = 'position-absolute top-50 start-50 translate-middle';
        playIcon.innerHTML = '<i class="bi bi-play-circle-fill text-white" style="font-size: 2rem;"></i>';
        cardBody.appendChild(playIcon);
    } else {
        mediaElement = document.createElement('div');
        mediaElement.className = 'card-img-top d-flex align-items-center justify-content-center bg-light';
        mediaElement.innerHTML = '<i class="bi bi-file-earmark" style="font-size: 2rem;"></i>';
    }

    cardBody.appendChild(mediaElement);
    cardDiv.appendChild(cardBody);
    card.appendChild(cardDiv);
    return card;
}
