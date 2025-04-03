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

// Add these variables at the top of your script
let isLoading = false;
let currentPage = 1;
let hasMore = true;
let currentFilter = 'all';
let scrollTimeout = null;

// Add this global variable to track scroll direction
let lastScrollTop = 0;

// Add a scroll direction detection function
function handleScrollDirection() {
    const st = window.pageYOffset || document.documentElement.scrollTop;
    
    // If scrolling up and not currently loading, clean up indicators
    if (st < lastScrollTop && !isLoading) {
        cleanupAllLoadingIndicators();
    }
    
    lastScrollTop = st <= 0 ? 0 : st; // For Mobile or negative scrolling
}

// Function to handle infinite scrolling
function handleScroll() {
    if (isLoading || !hasMore) return;

    // Clear existing timeout
    if (scrollTimeout) {
        clearTimeout(scrollTimeout);
    }

    // Set new timeout
    scrollTimeout = setTimeout(() => {
        const scrollPosition = window.innerHeight + window.scrollY;
        const bodyHeight = document.body.offsetHeight;
        const threshold = 800; // Load more when user is 800px from bottom

        if (scrollPosition >= bodyHeight - threshold) {
            console.log(`Loading more files - Page ${currentPage + 1} for filter ${currentFilter}`);
            
            // First clean up any existing loading indicators
            cleanupAllLoadingIndicators();
            
            // Add placeholder thumbnails only (no text header)
            const gallery = document.getElementById('gallery');
            if (gallery) {
                // Add exactly 5 placeholder thumbnails
                const placeholders = createPlaceholderThumbnails(5);
                gallery.appendChild(placeholders);
            }
            
            // Load the actual content
            loadGallery(currentFilter, currentPage + 1);
        }
    }, 100); // Debounce for 100ms
}

// Make sure this is outside any functions, at the global level
window.addEventListener('scroll', handleScroll);

// Update the loadGallery function to handle URL parameters
function loadGallery(filter = 'all', page = 1) {
    if (isLoading && page > 1) return;
    isLoading = true;

    // Update current filter
    currentFilter = filter;

    // Show loading spinner only on first load
    const loadingSpinner = document.getElementById('loadingSpinner');
    if (page === 1 && loadingSpinner) {
        loadingSpinner.classList.remove('d-none');
    }

    // For first page load, replace content with placeholders
    const gallery = document.getElementById('gallery');
    if (gallery && page === 1) {
        gallery.innerHTML = '';
        // Add placeholders for initial load (no text header)
        const placeholders = createPlaceholderThumbnails(5);
        gallery.appendChild(placeholders);
    }
    
    // Disable filter buttons while loading
    const filterButtons = document.querySelectorAll('.btn-filter');
    filterButtons.forEach(btn => btn.disabled = true);

    // Update URL without reloading the page
    const newUrl = new URL(window.location);
    newUrl.searchParams.set('filter', filter);
    window.history.pushState({}, '', newUrl);

    // Fetch files with filter and pagination
    fetch(`/uploads?filter=${filter}&page=${page}&limit=20`) // Still fetch 20 items
        .then(res => res.json())
        .then(async data => {
            // Handle both old and new response formats
            if (!data) {
                console.error('Received null or undefined data from server.');
                data = { files: [], counts: {}, hasMore: false, page: page };
            } else if (!Array.isArray(data) && !Array.isArray(data.files)) {
                console.warn(`Server response for filter "${filter}" did not contain a files array. Defaulting to empty.`);
                data.files = [];
            }
            
            const files = Array.isArray(data) 
                ? data.map(filename => ({ filename }))  // Old format: array of strings
                : (data.files || []);                   // New format: object with files array
                
            // Update pagination state
            if (data.hasMore !== undefined) {
                hasMore = data.hasMore;
            } else {
                hasMore = files.length >= 20;
            }
            
            currentPage = page;
            
            // Update tab labels with counts if available
            if (data.counts) {
                updateTabLabels(data.counts);
            }
            
            // Process files with a delay between each for a smoother appearance
            await processFilesSequentially(files, gallery, page);
            
            // Remove any remaining placeholders after all files are processed
            const remainingPlaceholders = gallery.querySelectorAll('.placeholder-thumbnail');
            remainingPlaceholders.forEach(placeholder => {
                placeholder.classList.add('fade-out');
                setTimeout(() => {
                    if (placeholder.parentNode) {
                        placeholder.remove();
                    }
                }, 300);
            });
            
            // Show "No more items" indicator if we've reached the end
            if (!hasMore && files.length > 0) {
                showNoMoreItemsIndicator();
            }
            
            console.log(`Loaded page ${currentPage}, hasMore: ${hasMore}, items: ${files.length}`);
            
            // Clean up ALL loading indicators
            cleanupAllLoadingIndicators();
        })
        .catch(error => {
            console.error('Error loading gallery:', error);
            
            // Remove placeholders on error
            const placeholders = gallery.querySelectorAll('.placeholder-thumbnail');
            placeholders.forEach(placeholder => placeholder.remove());
            
            // Show error message
            const errorMsg = document.createElement('div');
            errorMsg.className = 'col-12 alert alert-danger';
            errorMsg.textContent = `Error loading files: ${error.message}`;
            gallery.appendChild(errorMsg);
            
            // Clean up ALL loading indicators
            cleanupAllLoadingIndicators();
        })
        .finally(() => {
            // Hide loading spinner
            if (loadingSpinner) {
                loadingSpinner.classList.add('d-none');
            }
            
            // Re-enable filter buttons
            const filterButtons = document.querySelectorAll('.btn-filter');
            filterButtons.forEach(btn => btn.disabled = false);
            
            // Reset loading flag
            isLoading = false;
            
            // Final cleanup
            setTimeout(cleanupAllLoadingIndicators, 500);
            
            // Final cleanup of any remaining placeholders
            setTimeout(() => {
                const gallery = document.getElementById('gallery');
                if (gallery) {
                    const remainingPlaceholders = gallery.querySelectorAll('.placeholder-thumbnail');
                    remainingPlaceholders.forEach(placeholder => placeholder.remove());
                }
            }, 1000);
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
    const filename = selectedUrl.split('/').pop();
    
    // Truncate filename to prevent layout issues
    const truncatedFilename = truncateFilename(filename, 30); // Truncate to 30 chars

    if (isVideo) {
        // Show video in modal
        const carouselVideos = document.getElementById('carouselVideos');
        const videoModalTitle = document.querySelector('#videoModal .modal-title');
        
        if (!carouselVideos) {
            console.error('Video carousel element not found');
            return;
        }
        
        carouselVideos.innerHTML = ''; // Clear existing videos
        
        // Set modal title to truncated filename with tooltip
        if (videoModalTitle) {
            videoModalTitle.textContent = truncatedFilename;
            videoModalTitle.title = filename; // Show full filename on hover
        }

        // Update the video modal buttons
        updateModalButtons('videoModal', filename);

        fetch('/uploads?filter=video')
            .then(res => res.json())
            .then(data => {
                // Handle both old and new API response formats
                let fileList = [];
                
                if (Array.isArray(data)) {
                    // Old format: array of filenames
                    fileList = data.map(name => ({ filename: name }));
                } else if (data.files && Array.isArray(data.files)) {
                    // New format: object with files array
                    fileList = data.files;
                } else {
                    console.warn('Unexpected response format:', data);
                    // Create single item for current video
                    fileList = [{ filename: filename }];
                }
                
                fileList.forEach((fileObj) => {
                    // Get filename (handle both old and new format)
                    const fname = fileObj.filename;
                    const fileExt = fname.split('.').pop().toLowerCase();
                    const isVideoFile = ['mp4', 'webm', 'mov'].includes(fileExt);
                    const url = `/uploads/${fname}`;

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
                
                // If no items were added, create one for the current video
                if (carouselVideos.children.length === 0) {
                    const carouselItem = document.createElement('div');
                    carouselItem.className = 'carousel-item active';
                    const video = document.createElement('video');
                    video.src = selectedUrl;
                    video.className = 'd-block w-100';
                    video.controls = true;
                    video.autoplay = true;
                    carouselItem.appendChild(video);
                    carouselVideos.appendChild(carouselItem);
                }
            })
            .catch(error => {
                console.error('Error fetching videos:', error);
                // Create fallback for the current video
                const carouselItem = document.createElement('div');
                carouselItem.className = 'carousel-item active';
                const video = document.createElement('video');
                video.src = selectedUrl;
                video.className = 'd-block w-100';
                video.controls = true;
                video.autoplay = true;
                carouselItem.appendChild(video);
                carouselVideos.appendChild(carouselItem);
            });

        const videoModal = new bootstrap.Modal(document.getElementById('videoModal'));
        videoModal.show();
    } else {
        // Handle images in the modal with carousel
        const carouselImages = document.getElementById('carouselImages');
        const imageModalTitle = document.querySelector('#imageModal .modal-title');
        
        if (!carouselImages) {
            console.error('Image carousel element not found');
            return;
        }
        
        carouselImages.innerHTML = ''; // Clear existing images
        
        // Set modal title to truncated filename with tooltip
        if (imageModalTitle) {
            imageModalTitle.textContent = truncatedFilename;
            imageModalTitle.title = filename; // Show full filename on hover
        }

        // Update the image modal buttons
        updateModalButtons('imageModal', filename);

        fetch('/uploads?filter=image')
            .then(res => res.json())
            .then(data => {
                // Handle both old and new API response formats
                let fileList = [];
                
                if (Array.isArray(data)) {
                    // Old format: array of filenames
                    fileList = data.map(name => ({ filename: name }));
                } else if (data.files && Array.isArray(data.files)) {
                    // New format: object with files array
                    fileList = data.files;
                } else {
                    console.warn('Unexpected response format:', data);
                    // Create single item for current image
                    fileList = [{ filename: filename }];
                }
                
                // Optionally reverse the array to show newest images first
                fileList.reverse().forEach((fileObj) => {
                    // Get filename (handle both old and new format)
                    const fname = fileObj.filename;
                    const fileExt = fname.split('.').pop().toLowerCase();
                    const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(fileExt);
                    const url = `/uploads/${fname}`;
                    const activeClass = url === selectedUrl ? 'active' : '';

                    if (isImage) {
                        carouselImages.insertAdjacentHTML('beforeend', `
                            <div class="carousel-item ${activeClass}">
                                <img src="${url}" class="d-block w-100" alt="${fname}">
                            </div>
                        `);
                    }
                });
                
                // If no items were added, create one for the current image
                if (carouselImages.children.length === 0) {
                    carouselImages.insertAdjacentHTML('beforeend', `
                        <div class="carousel-item active">
                            <img src="${selectedUrl}" class="d-block w-100" alt="${filename}">
                        </div>
                    `);
                }

                // Add keydown event listener for navigation
                document.addEventListener('keydown', handleKeydown);
            })
            .catch(error => {
                console.error('Error fetching images:', error);
                // Create fallback for the current image
                carouselImages.insertAdjacentHTML('beforeend', `
                    <div class="carousel-item active">
                        <img src="${selectedUrl}" class="d-block w-100" alt="${filename}">
                    </div>
                `);
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
            // Immediately remove all placeholders when changing filters
            const gallery = document.getElementById('gallery');
            if (gallery) {
                const allPlaceholders = gallery.querySelectorAll('.placeholder-thumbnail');
                allPlaceholders.forEach(placeholder => placeholder.remove());
                
                // Also remove any loading indicators
                const loadingIndicators = gallery.querySelectorAll('.loading-batch-header, .gallery-loading-indicator, .scroll-loading-indicator');
                loadingIndicators.forEach(indicator => indicator.remove());
            }
            
            // Disable all filter buttons while loading
            filterButtons.forEach(btn => btn.disabled = true);
            
            // Remove active class from all buttons
            filterButtons.forEach(btn => btn.classList.remove('active'));
            // Add active class to clicked button
            this.classList.add('active');
            
            // Reset pagination when changing filters
            currentPage = 1;
            hasMore = true;
            
            // Apply filter
            loadGallery(this.dataset.filter, 1);
        });
    });

    // Load gallery with filter from URL on page load
    const filter = getUrlParameter('filter') || 'all';
    loadGallery(filter, 1);
    
    // Add Back to Top button
    addBackToTopButton();
    
    // Ensure scroll listener is attached
    window.removeEventListener('scroll', handleScroll); // Remove first to avoid duplicates
    window.addEventListener('scroll', handleScroll);

    // Add this to your DOMContentLoaded event handler
    document.addEventListener('click', function(event) {
        // Check if click was on a loading indicator or its close button
        if (event.target.closest('.gallery-loading-indicator') || 
            event.target.closest('.scroll-loading-indicator')) {
            const indicator = event.target.closest('.gallery-loading-indicator') || 
                              event.target.closest('.scroll-loading-indicator');
            indicator.remove();
        }
    });

    // Add this to your DOMContentLoaded event handler
    window.addEventListener('scroll', handleScrollDirection);

    // Remove debug buttons if they exist
    const loadMoreDebugBtn = document.getElementById('loadMoreDebug');
    if (loadMoreDebugBtn) loadMoreDebugBtn.remove();
    
    const cleanupBtn = document.getElementById('cleanupPlaceholdersBtn');
    if (cleanupBtn) cleanupBtn.remove();
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

/**
 * Updates the tab labels with file counts
 * @param {Object} counts - Object containing file counts by type
 */
function updateTabLabels(counts) {
    const allTab = document.querySelector('[data-filter="all"]');
    const imageTab = document.querySelector('[data-filter="image"]');
    const videoTab = document.querySelector('[data-filter="video"]');
    const otherTab = document.querySelector('[data-filter="other"]');

    if (allTab) allTab.textContent = `All Files (${counts.all || 0})`;
    if (imageTab) imageTab.textContent = `Images (${counts.images || 0})`;
    if (videoTab) videoTab.textContent = `Videos (${counts.videos || 0})`;
    if (otherTab) otherTab.textContent = `Other (${counts.others || 0})`;
}

// Add these variables at the top of your script.js file
let lazyLoadObserver;

/**
 * Initialize lazy loading with Intersection Observer
 */
function initLazyLoading() {
    // Get all images with the loading="lazy" attribute
    const lazyImages = document.querySelectorAll('img[loading="lazy"]');
    
    // If IntersectionObserver is available, use it
    if ('IntersectionObserver' in window) {
        const imageObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    // Add a class for fade-in effect
                    img.classList.add('fade-in');
                    // Stop observing the image
                    imageObserver.unobserve(img);
                }
            });
        }, {
            rootMargin: '200px', // Start loading images when they're 200px from viewport
            threshold: 0.1
        });
        
        lazyImages.forEach(img => {
            imageObserver.observe(img);
        });
    }
}

function generateVideoThumbnail(url, filename, containerElement) {
    captureVideoFrame(url, function(thumbnail, duration) {
        try {
            // Try to cache the thumbnail and duration
            localStorage.setItem(`thumb_${filename}`, thumbnail);
            localStorage.setItem(`duration_${filename}`, duration);
        } catch (e) {
            // If storage is full, clear old thumbnails and try again
            if (e.name === 'QuotaExceededError') {
                clearOldThumbnails();
                try {
                    localStorage.setItem(`thumb_${filename}`, thumbnail);
                    localStorage.setItem(`duration_${filename}`, duration);
                } catch (e2) {
                    console.warn('Failed to cache thumbnail:', e2);
                }
            }
        }
        
        // Replace the placeholder with the actual thumbnail
        containerElement.innerHTML = `
            <div class="card h-100">
                <div class="position-relative">
                    <img src="${thumbnail}" class="card-img-top" onclick="showImageModal('${url}')">
                    <span class="position-absolute bottom-0 end-0 badge bg-dark m-2">
                        ${duration}
                    </span>
                    <div class="position-absolute" style="top: 0; left: 0; right: 0; bottom: 0; display: flex; justify-content: center; align-items: center; pointer-events: none;">
                        <i class="bi bi-play-circle-fill text-white" style="font-size: 2rem; opacity: 0.8;"></i>
                    </div>
                </div>
            </div>`;
    });
}

// Back to Top button function
function addBackToTopButton() {
    // Create button if it doesn't exist
    if (!document.getElementById('backToTopBtn')) {
        const backToTopBtn = document.createElement('button');
        backToTopBtn.id = 'backToTopBtn';
        backToTopBtn.className = 'btn btn-primary position-fixed bottom-0 end-0 m-4 d-none';
        backToTopBtn.innerHTML = '<i class="bi bi-arrow-up"></i>';
        document.body.appendChild(backToTopBtn);
    }
    
    const backToTopBtn = document.getElementById('backToTopBtn');
    
    // Show button when user scrolls down past header
    window.addEventListener('scroll', function() {
        const headerHeight = document.querySelector('h2').offsetHeight + 50;
        if (window.scrollY > headerHeight) {
            backToTopBtn.classList.remove('d-none');
        } else {
            backToTopBtn.classList.add('d-none');
        }
    });
    
    // Scroll to top when button is clicked
    backToTopBtn.addEventListener('click', function() {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });
}

// Add this function to periodically clean up any stale loading indicators
function cleanupStaleLoadingIndicators() {
    if (!isLoading) {
        const gallery = document.getElementById('gallery');
        if (gallery) {
            const loadingIndicators = gallery.querySelectorAll('.gallery-loading-indicator, .scroll-loading-indicator');
            if (loadingIndicators.length > 0) {
                console.log(`Cleaning up ${loadingIndicators.length} stale loading indicators`);
                loadingIndicators.forEach(indicator => indicator.remove());
            }
        }
    }
}

// Call this function periodically
setInterval(cleanupStaleLoadingIndicators, 5000);

/**
 * Creates a smaller set of placeholder thumbnails to show while loading content
 * @param {number} count - Number of placeholders to create
 * @returns {DocumentFragment} Fragment containing placeholder thumbnails
 */
function createPlaceholderThumbnails(count = 5) {
    // Always use exactly 5 thumbnails
    count = 5;
    
    const fragment = document.createDocumentFragment();
    
    for (let i = 0; i < count; i++) {
        const col = document.createElement('div');
        col.className = 'col-3 mb-3 placeholder-thumbnail';
        col.dataset.placeholderId = `placeholder-${Date.now()}-${i}`;
        
        // Enhanced placeholder with larger spinner and gradient background
        col.innerHTML = `
            <div class="card h-100 position-relative">
                <div class="placeholder-content" style="aspect-ratio: 1/1; background: linear-gradient(to bottom right, #f0f0f0, #e6e6e6); border-radius: 4px;">
                    <div class="position-absolute top-50 start-50 translate-middle text-center">
                        <div class="spinner-border text-primary" role="status" style="width: 2rem; height: 2rem;">
                            <span class="visually-hidden">Loading...</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Add a shimmer effect
        const shimmer = document.createElement('div');
        shimmer.className = 'shimmer-effect';
        col.querySelector('.placeholder-content').appendChild(shimmer);
        
        fragment.appendChild(col);
    }
    
    return fragment;
}

/**
 * Replaces a placeholder with actual content with a smooth transition
 * @param {HTMLElement} placeholder - The placeholder element to replace
 * @param {HTMLElement} realContent - The real content element
 */
function replacePlaceholderWithContent(placeholder, realContent) {
    realContent.classList.add('real-item-appearing');
    placeholder.parentNode.insertBefore(realContent, placeholder);
    
    placeholder.classList.add('fade-out');
    setTimeout(() => {
        if (placeholder.parentNode) {
            placeholder.remove();
        }
    }, 500);
}

/**
 * Shows "No more items" indicator when all content is loaded
 */
function showNoMoreItemsIndicator() {
    const gallery = document.getElementById('gallery');
    if (!gallery) return;
    
    // Check if indicator already exists
    if (gallery.querySelector('.no-more-items')) return;
    
    const indicator = document.createElement('div');
    indicator.className = 'col-12 text-center py-4 my-3 no-more-items';
    indicator.innerHTML = `
        <div class="text-muted">
            <i class="bi bi-check-circle"></i> 
            You've reached the end of the content
        </div>
    `;
    
    gallery.appendChild(indicator);
    
    // Animate it
    setTimeout(() => {
        indicator.style.transition = 'opacity 0.5s ease-in-out';
        indicator.style.opacity = '1';
    }, 100);
}

/**
 * Periodically checks for and removes any lingering placeholder thumbnails
 */
function cleanupPlaceholders() {
    if (!isLoading) {
        const gallery = document.getElementById('gallery');
        if (gallery) {
            const remainingPlaceholders = gallery.querySelectorAll('.placeholder-thumbnail');
            if (remainingPlaceholders.length > 0) {
                console.warn(`Cleanup: Found ${remainingPlaceholders.length} remaining placeholders. Removing them.`);
                remainingPlaceholders.forEach(placeholder => {
                    placeholder.classList.add('fade-out');
                    setTimeout(() => {
                        if (placeholder.parentNode) {
                            placeholder.remove();
                        }
                    }, 300);
                });
            }
        }
    }
}

// Run cleanup every 5 seconds
setInterval(cleanupPlaceholders, 5000);

/**
 * Processes files sequentially with a delay between each for a smoother appearance
 * @param {Array} files - Array of files to process
 * @param {HTMLElement} gallery - The gallery element to append to
 * @param {number} page - Current page number
 */
async function processFilesSequentially(files, gallery, page) {
    // Get last modified dates (only needed for old format)
    let filesWithDates = files;
    
    if (Array.isArray(files) && files.length > 0 && !files[0].date) {
        try {
            // Old format processing - get dates and sort
            filesWithDates = await Promise.all(files.map(async fileObj => {
                const url = `/uploads/${fileObj.filename}`;
                const response = await fetch(url, { method: 'HEAD' });
                const lastModified = new Date(response.headers.get('last-modified'));
                return { ...fileObj, date: lastModified };
            }));
            
            // Sort files by date in descending order
            filesWithDates.sort((a, b) => b.date - a.date);
        } catch (error) {
            console.warn('Error getting file dates:', error);
            // Continue with unsorted files
        }
    }
    
    // Create a document fragment for each file and append it with a delay
    for (let i = 0; i < filesWithDates.length; i++) {
        const fileObj = filesWithDates[i];
        
        // Handle both old and new format
        const filename = fileObj.filename;
        const ext = filename.split('.').pop().toLowerCase();
        const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
        const isVideo = ['mp4', 'webm', 'mov'].includes(ext);
        const url = `/uploads/${filename}`;
        
        // Process the file based on type
        const col = document.createElement('div');
        col.className = 'col-3 mb-3 real-item appearing-item';
        col.setAttribute('data-filename', filename);
        
        try {
            if (isImage) {
                // Check if thumbnail exists in cache
                const cachedThumbnail = localStorage.getItem(`img_thumb_${filename}`);
                
                if (cachedThumbnail) {
                    // Use cached thumbnail
                    col.innerHTML = `
                        <div class="card h-100">
                            <img src="${cachedThumbnail}" class="card-img-top" loading="lazy" onclick="showImageModal('${url}')">
                        </div>`;
                } else {
                    // Use original image as placeholder
                    col.innerHTML = `
                        <div class="card h-100">
                            <img src="${url}" class="card-img-top" loading="lazy" onclick="showImageModal('${url}')">
                        </div>`;
                    
                    // Generate thumbnail asynchronously
                    createImageThumbnail(url).then(thumbnail => {
                        try {
                            localStorage.setItem(`img_thumb_${filename}`, thumbnail);
                            // Optionally update the image once the thumbnail is ready
                            const imgElement = col.querySelector('img');
                            if (imgElement) imgElement.src = thumbnail;
                        } catch (e) {
                            if (e.name === 'QuotaExceededError') {
                                clearOldThumbnails();
                            }
                        }
                    }).catch(e => console.warn('Error generating thumbnail:', e));
                }
            } else if (isVideo) {
                // Check if thumbnail exists in cache
                const cachedThumbnail = localStorage.getItem(`thumb_${filename}`);
                const cachedDuration = localStorage.getItem(`duration_${filename}`);
                
                if (cachedThumbnail && cachedDuration) {
                    // Use cached thumbnail and duration
                    col.innerHTML = `
                        <div class="card h-100">
                            <div class="position-relative">
                                <img src="${cachedThumbnail}" class="card-img-top" onclick="showImageModal('${url}')">
                                <span class="position-absolute bottom-0 end-0 badge bg-dark m-2">
                                    ${cachedDuration}
                                </span>
                                <div class="position-absolute" style="top: 0; left: 0; right: 0; bottom: 0; display: flex; justify-content: center; align-items: center; pointer-events: none;">
                                    <i class="bi bi-play-circle-fill text-white" style="font-size: 2rem; opacity: 0.8;"></i>
                                </div>
                            </div>
                        </div>`;
                } else {
                    // Create a placeholder for the video with a loading spinner
                    col.innerHTML = `
                        <div class="card h-100">
                            <div class="position-relative">
                                <div class="card-img-top bg-dark text-white d-flex align-items-center justify-content-center" style="aspect-ratio: 1/1;">
                                    <div class="spinner-border text-light" role="status">
                                        <span class="visually-hidden">Loading video thumbnail...</span>
                                    </div>
                                </div>
                                <div class="position-absolute" style="top: 0; left: 0; right: 0; bottom: 0; display: flex; justify-content: center; align-items: center; pointer-events: none;">
                                    <i class="bi bi-play-circle-fill text-white" style="font-size: 2rem; opacity: 0.8;"></i>
                                </div>
                            </div>
                        </div>`;
                    
                    // Generate thumbnail asynchronously
                    captureVideoFrame(url, function(thumbnail, duration) {
                        try {
                            localStorage.setItem(`thumb_${filename}`, thumbnail);
                            localStorage.setItem(`duration_${filename}`, duration);
                            
                            // Update the placeholder with the actual thumbnail
                            col.innerHTML = `
                                <div class="card h-100">
                                    <div class="position-relative">
                                        <img src="${thumbnail}" class="card-img-top" onclick="showImageModal('${url}')">
                                        <span class="position-absolute bottom-0 end-0 badge bg-dark m-2">
                                            ${duration}
                                        </span>
                                        <div class="position-absolute" style="top: 0; left: 0; right: 0; bottom: 0; display: flex; justify-content: center; align-items: center; pointer-events: none;">
                                            <i class="bi bi-play-circle-fill text-white" style="font-size: 2rem; opacity: 0.8;"></i>
                                        </div>
                                    </div>
                                </div>`;
                        } catch (e) {
                            if (e.name === 'QuotaExceededError') {
                                clearOldThumbnails();
                            }
                        }
                    });
                }
            } else {
                // Other file types
                col.innerHTML = `
                    <div class="card h-100">
                        <div class="card-body text-center">
                            <div class="small text-muted mb-2">${filename}</div>
                            <a href="${url}" download class="btn btn-primary btn-sm">
                                <i class="bi bi-download"></i> Download
                            </a>
                        </div>
                    </div>`;
            }
        } catch (error) {
            console.warn('Error handling file:', error);
            // Create a simple fallback card
            col.innerHTML = `
                <div class="card h-100">
                    <div class="card-body text-center">
                        <div class="small text-muted mb-2">${filename}</div>
                        <a href="${url}" class="btn btn-outline-primary btn-sm">View</a>
                    </div>
                </div>`;
        }
        
        // Add a small delay between each item for a smoother appearance
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // Remove a placeholder if available
        const placeholder = gallery.querySelector('.placeholder-thumbnail');
        if (placeholder) {
            placeholder.classList.add('fade-out');
            setTimeout(() => {
                if (placeholder.parentNode) {
                    placeholder.remove();
                }
            }, 300);
        }
        
        // Add the new item to the gallery with a fade-in effect
        gallery.appendChild(col);
        
        // Force a reflow to trigger animation
        void col.offsetWidth;
        col.classList.add('fade-in');
    }
}

// In the loadGallery function, add this to handle cleaning up ALL loading indicators
function cleanupAllLoadingIndicators() {
    const gallery = document.getElementById('gallery');
    if (gallery) {
        // Find ALL placeholder thumbnails
        const placeholders = gallery.querySelectorAll('.placeholder-thumbnail');
        if (placeholders.length > 0) {
            console.log(`Cleaning up ${placeholders.length} placeholder thumbnails`);
            placeholders.forEach(placeholder => {
                placeholder.classList.add('fade-out');
                setTimeout(() => {
                    if (placeholder.parentNode) {
                        placeholder.remove();
                    }
                }, 300);
            });
        }
        
        // Also clean up any old text indicators that might exist
        const loadingTexts = gallery.querySelectorAll('.loading-batch-header, .scroll-loading-indicator, .gallery-loading-indicator');
        loadingTexts.forEach(indicator => indicator.remove());
    }
}

// Update the interval cleanup to be more aggressive
function periodicCleanup() {
    // Only run if not actively loading
    if (!isLoading) {
        // Clean up loading indicators
        cleanupAllLoadingIndicators();
        
        // Clean up placeholders
        const gallery = document.getElementById('gallery');
        if (gallery) {
            const placeholders = gallery.querySelectorAll('.placeholder-thumbnail');
            if (placeholders.length > 0) {
                console.log(`Periodic cleanup: Found ${placeholders.length} placeholder thumbnails`);
                placeholders.forEach(placeholder => placeholder.remove());
            }
        }
    }
}

// Run this cleanup every 3 seconds
setInterval(periodicCleanup, 3000);

/**
 * Truncates a filename to the specified length
 * @param {string} filename - The filename to truncate
 * @param {number} maxLength - Maximum length of the truncated filename
 * @returns {string} Truncated filename
 */
function truncateFilename(filename, maxLength = 30) {
    if (filename.length <= maxLength) return filename;
    
    const extension = filename.split('.').pop();
    const nameWithoutExt = filename.substring(0, filename.length - extension.length - 1);
    
    // Keep extension and truncate middle of filename
    if (nameWithoutExt.length > maxLength - 3 - extension.length) {
        const start = Math.ceil((maxLength - 3 - extension.length) / 2);
        const end = nameWithoutExt.length - start;
        return `${nameWithoutExt.substring(0, start)}...${nameWithoutExt.substring(end)}.${extension}`;
    }
    
    return filename;
}

/**
 * Updates the delete and close buttons in the modal
 * @param {string} modalId - The ID of the modal to update
 * @param {string} filename - The filename of the current file
 */
function updateModalButtons(modalId, filename) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    
    // Get or create the button container
    let buttonContainer = modal.querySelector('.modal-footer');
    if (!buttonContainer) {
        buttonContainer = document.createElement('div');
        buttonContainer.className = 'modal-footer';
        modal.querySelector('.modal-content').appendChild(buttonContainer);
    }
    
    // Clear existing buttons
    buttonContainer.innerHTML = '';
    
    // Add delete button
    const deleteButton = document.createElement('button');
    deleteButton.className = 'btn btn-danger';
    deleteButton.innerHTML = '<i class="bi bi-trash"></i> Delete';
    deleteButton.onclick = () => {
        // Close the modal first
        const modalInstance = bootstrap.Modal.getInstance(modal);
        modalInstance.hide();
        
        // Confirm deletion
        if (confirm(`Are you sure you want to delete "${filename}"?`)) {
            deleteFile(filename);
        }
    };
    buttonContainer.appendChild(deleteButton);
    
    // Add close button
    const closeButton = document.createElement('button');
    closeButton.className = 'btn btn-secondary';
    closeButton.innerHTML = '<i class="bi bi-x-circle"></i> Close';
    closeButton.setAttribute('data-bs-dismiss', 'modal');
    buttonContainer.appendChild(closeButton);
}

/**
 * Shows a toast notification
 * @param {string} type - The type of toast ('success', 'error', 'warning', 'info')
 * @param {string} message - The message to display
 */
function showToast(type, message) {
    // Create toast container if it doesn't exist
    let toastContainer = document.querySelector('.toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container position-fixed top-0 end-0 p-3';
        document.body.appendChild(toastContainer);
    }
    
    // Set icon and color based on type
    let iconClass = 'bi-info-circle';
    let bgClass = 'bg-primary';
    
    switch(type) {
        case 'success':
            iconClass = 'bi-check-circle';
            bgClass = 'bg-success';
            break;
        case 'error':
            iconClass = 'bi-exclamation-circle';
            bgClass = 'bg-danger';
            break;
        case 'warning':
            iconClass = 'bi-exclamation-triangle';
            bgClass = 'bg-warning';
            break;
    }
    
    // Create toast element
    const toastId = `toast-${Date.now()}`;
    const toastEl = document.createElement('div');
    toastEl.className = 'toast show';
    toastEl.id = toastId;
    toastEl.innerHTML = `
        <div class="toast-header ${bgClass} text-white">
            <i class="bi ${iconClass} me-2"></i>
            <strong class="me-auto">${type.charAt(0).toUpperCase() + type.slice(1)}</strong>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast"></button>
        </div>
        <div class="toast-body">
            ${message}
        </div>
    `;
    
    // Add toast to container
    toastContainer.appendChild(toastEl);
    
    // Initialize Bootstrap toast
    const toast = new bootstrap.Toast(toastEl, { autohide: true, delay: 5000 });
    toast.show();
    
    // Remove toast after it's hidden
    toastEl.addEventListener('hidden.bs.toast', () => {
        if (toastEl.parentNode) {
            toastEl.remove();
        }
    });
}
