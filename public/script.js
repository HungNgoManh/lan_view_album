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

    // Check for duplicate files - get ALL files without pagination
    const response = await fetch('/uploads?checkDuplicates=true');
    const data = await response.json();
    
    // Extract filenames from the response
    // The server returns { files: [{filename, size, modified, type}, ...], ... }
    const existingFiles = data && data.files && Array.isArray(data.files) 
        ? data.files.map(file => file.filename) 
        : [];
    
    console.log(`Checking for duplicates against existing files (${existingFiles.length}/${data?.counts?.all || 'unknown'} total files):`);

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

        // Clear the filter cache since new files have been added
        clearFilterCache();
        
        // Reload the gallery
        loadGallery(currentFilter, 1, true);
        
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

// Add these global variables at the top of your script
let isModalOpen = false;
let loadingPaused = false;
let loadingQueue = [];

// Add a cache object to store loaded content by filter
const filterCache = {
    all: { loaded: false, html: '', currentPage: 0, hasMore: true, counts: {} },
    image: { loaded: false, html: '', currentPage: 0, hasMore: true, counts: {} },
    video: { loaded: false, html: '', currentPage: 0, hasMore: true, counts: {} },
    other: { loaded: false, html: '', currentPage: 0, hasMore: true, counts: {} }
};

// Add a function to save the current state to cache
function saveToFilterCache(filter) {
    const gallery = document.getElementById('gallery');
    if (gallery) {
        // Remove any placeholder thumbnails before saving to cache
        const placeholders = gallery.querySelectorAll('.placeholder-thumbnail');
        placeholders.forEach(placeholder => placeholder.remove());
        
        // Now save the clean gallery HTML to cache
        filterCache[filter].loaded = true;
        filterCache[filter].html = gallery.innerHTML;
        filterCache[filter].currentPage = currentPage;
        filterCache[filter].hasMore = hasMore;
        console.log(`Saved ${filter} filter state to cache (page ${currentPage})`);
    }
}

// Update the loadGallery function to properly use cache when available
function loadGallery(filter = 'all', page = 1, forceReload = false) {
    // Prevent duplicate loading requests
    if (isLoading) {
        console.log(`Skipping duplicate loading request (filter: ${filter}, page: ${page})`);
            return;
        }

    // Skip everything and use cache immediately if available and not forcing reload
    if (!forceReload && filterCache[filter].loaded && page === 1) {
        console.log(`Loading ${filter} filter directly from cache`);
        
        // Get the gallery element
        const gallery = document.getElementById('gallery');
        if (gallery) {
            // First clear any existing content including placeholders
            gallery.innerHTML = '';
            
            // Apply cached content directly
            gallery.innerHTML = filterCache[filter].html;
            currentPage = filterCache[filter].currentPage;
            hasMore = filterCache[filter].hasMore;
            currentFilter = filter;
            
            // Reattach event handlers to the cached content
            reattachEventHandlers();
            
            // Update UI states immediately
            updateFilterButtonState(filter);
            
            // Update URL without reloading the page
            const newUrl = new URL(window.location);
            newUrl.searchParams.set('filter', filter);
            window.history.pushState({}, '', newUrl);
            
            console.log(`Restored ${filter} filter from cache (page ${currentPage})`);
            return;
        }
    }
    
    // If we got here, we need to load content from the server
    isLoading = true;

    // Update current filter
    currentFilter = filter;

    console.log(`Loading gallery with filter: ${filter}, page: ${page}`);

    // For first page load, replace content with placeholders
        const gallery = document.getElementById('gallery');
    if (gallery && page === 1) {
        // Clear existing content completely before adding new content
        gallery.innerHTML = '';
        
        // Add more placeholders for initial load to fill the screen better
        const placeholders = createPlaceholderThumbnails(10);
        gallery.appendChild(placeholders);
    } else if (gallery && page > 1) {
        // For pagination, add placeholders with the same style as initial load
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

    // Fetch files with filter, pagination, and explicit sort order
    fetch(`/uploads?filter=${filter}&page=${page}&limit=25&sort=date&order=desc`)
        .then(res => {
            if (!res.ok) {
                // Special handling for 500 errors when likely due to empty category
                if (res.status === 500 && ['image', 'video', 'other'].includes(filter)) {
                    console.warn(`Server error for filter "${filter}", treating as empty category`);
                    // Return a mock empty response
                    return {
                        files: [],
                        counts: {
                            all: 0,
                            images: 0,
                            videos: 0,
                            others: 0
                        },
                        hasMore: false,
                        page: page
                    };
                }
                
                throw new Error(`HTTP error! status: ${res.status}`);
            }
            return res.json();
        })
        .then(data => {
            // Standardize the response format
            let standardizedData = {
                files: [],
                counts: {
                    all: 0,
                    images: 0,
                    videos: 0,
                    others: 0
                },
                hasMore: false,
                page: page
            };
            
            // Handle various response formats
            if (Array.isArray(data)) {
                // Old format: array of filenames
                standardizedData.files = data.map(filename => ({ filename }));
                standardizedData.hasMore = data.length >= 25;
            } else if (data && typeof data === 'object') {
                // New format with potential missing properties
                standardizedData.files = Array.isArray(data.files) ? data.files : [];
                standardizedData.counts = data.counts || standardizedData.counts;
                standardizedData.hasMore = data.hasMore !== undefined ? data.hasMore : false;
                standardizedData.page = data.page || page;
            } else {
                console.warn(`Unexpected response format for filter "${filter}":`, data);
            }
            
            // Update app state with the standardized data
            currentPage = standardizedData.page;
            hasMore = standardizedData.hasMore;
            
            // Update tab labels with counts
            updateTabLabels(standardizedData.counts);
            
            // Process the gallery with standardized data
            return processGalleryData(standardizedData, gallery, page, filter);
        })
        .catch(error => {
            console.error('Error loading gallery:', error);
            
            // Show user-friendly error message
            if (page === 1) {
                gallery.innerHTML = `
                    <div class="col-12 text-center py-5">
                        <div class="alert alert-danger" role="alert">
                            <i class="bi bi-exclamation-triangle-fill me-2"></i>
                            Error loading content: ${error.message}
                        </div>
                        <button class="btn btn-primary mt-3" onclick="loadGallery('${filter}', 1)">
                            <i class="bi bi-arrow-clockwise me-2"></i> Try Again
                        </button>
                    </div>
                `;
            } else {
                // For subsequent pages, show error at bottom
                const errorDiv = document.createElement('div');
                errorDiv.className = 'col-12 text-center py-3';
                errorDiv.innerHTML = `
                    <div class="alert alert-warning">
                        Failed to load more items. 
                        <button class="btn btn-sm btn-outline-primary ms-2" onclick="loadGallery('${filter}', ${page})">
                            Try Again
                        </button>
                    </div>
                `;
                gallery.appendChild(errorDiv);
            }
        })
        .finally(() => {
            // Re-enable filter buttons
            filterButtons.forEach(btn => btn.disabled = false);
            
            // Reset loading flag
            isLoading = false;
            
            // Ensure the correct filter button is active
            updateFilterButtonState(filter);
            
            // Save current state to cache if this is page 1 or later
            if (page >= 1) {
                saveToFilterCache(filter);
            }
        });
    }
    
/**
 * Processes gallery data and updates the UI
 * @param {Object} data - The standardized data object
 * @param {HTMLElement} gallery - The gallery element
 * @param {number} page - The current page number
 * @param {string} filter - The current filter
 * @returns {Promise} - A promise that resolves when processing is complete
 */
function processGalleryData(data, gallery, page, filter) {
    // Don't remove placeholders yet, we'll do that after content loads
    
    // Check if there are no files to display
    if (!data.files || data.files.length === 0) {
        // If this is page 1, show empty state message
        if (page === 1) {
            // Now we can safely remove all placeholders
            const allPlaceholders = gallery.querySelectorAll('.placeholder-thumbnail');
            allPlaceholders.forEach(placeholder => placeholder.remove());
            
            // Clear any existing content first to prevent duplicates
            gallery.innerHTML = '';
            
            let message = 'No files found';
            let icon = 'bi-folder-x';
            
            // Customize message based on filter
            switch(filter) {
                case 'image':
                    message = 'No images found';
                    icon = 'bi-card-image';
                    break;
                case 'video':
                    message = 'No videos found';
                    icon = 'bi-camera-video';
                    break;
                case 'other':
                    message = 'No documents found';
                    icon = 'bi-file-earmark';
                    break;
            }
            
            gallery.innerHTML = `
                <div class="col-12 text-center py-5">
                    <div class="empty-state">
                        <i class="bi ${icon}" style="font-size: 3rem; opacity: 0.2;"></i>
                        <h5 class="mt-3">${message}</h5>
                        <p class="text-muted">Upload some files to see them here</p>
                        <button class="btn btn-primary mt-2" onclick="document.getElementById('upload-tab').click()">
                            <i class="bi bi-upload me-2"></i> Upload Files
                        </button>
                                </div>
                                </div>
            `;
                } else {
            // End of content for pagination
            showEndOfContentMessage(gallery);
            
            // Remove pagination placeholders
            const paginationPlaceholders = gallery.querySelectorAll('.placeholder-thumbnail');
            paginationPlaceholders.forEach(placeholder => {
                placeholder.classList.add('fade-out');
                setTimeout(() => placeholder.remove(), 300);
            });
        }
        
        // Update hasMore flag
        hasMore = false;
        
        // Nothing more to process
        return Promise.resolve();
    }
    
    // Update hasMore flag based on the data
    hasMore = data.hasMore !== undefined ? data.hasMore : data.files.length >= 25;
    
    // If we have less than 25 items, we've reached the end
    if (data.files.length < 25) {
        hasMore = false;
    }
    
    // Process files with the existing function
    return processFilesSequentially(data.files, gallery, page).then(() => {
        // After processing files, we can safely remove placeholders
        const allPlaceholders = gallery.querySelectorAll('.placeholder-thumbnail');
        if (allPlaceholders.length > 0) {
            console.log(`Removing ${allPlaceholders.length} placeholders after content load`);
            allPlaceholders.forEach(placeholder => {
                // Remove directly without animation for cleaner switch
                placeholder.remove();
            });
        }
        
        // After processing files, show end message if we've reached the end
        if (!hasMore) {
            showEndOfContentMessage(gallery);
            }
        });
    }

function showEndOfContentMessage(gallery) {
    // Remove any existing end message
    const existingEndMessage = gallery.querySelector('.no-more-items');
    if (existingEndMessage) {
        existingEndMessage.remove();
    }

    // Show the message if we've reached the end of content
    if (!hasMore) {
        const endMessage = document.createElement('div');
        endMessage.className = 'col-12 text-center py-4 no-more-items';
        endMessage.innerHTML = `
            <div class="alert alert-light">
                <i class="bi bi-check-circle me-2"></i>
                You've reached the end of the content
            </div>
        `;
        gallery.appendChild(endMessage);
    }
}

/**
 * Deletes a file via API call and maintains current filter
 * @param {string} filename - The filename to delete
 */
function deleteFile(filename) {
    // Store current filter before deletion
    const currentFilterBeforeDeletion = currentFilter;
    
    // Show a loading spinner
    const loadingEl = document.createElement('div');
    loadingEl.className = 'position-fixed top-50 start-50 translate-middle bg-white p-4 rounded shadow-lg';
    loadingEl.innerHTML = `
        <div class="d-flex align-items-center">
            <div class="spinner-border text-primary me-3" role="status">
                <span class="visually-hidden">Deleting...</span>
            </div>
            <div>Deleting "${truncateFilename(filename, 20)}"...</div>
        </div>
    `;
    document.body.appendChild(loadingEl);
    
    // Make the delete request
    fetch(`/delete/${filename}`, { method: 'DELETE' })
        .then(response => {
            if (!response.ok) {
                throw new Error(`Failed to delete: ${response.status} ${response.statusText}`);
            }
            return response.json();
        })
        .then((data) => {
            // Check if the file was the last one in its category
            const ext = filename.split('.').pop().toLowerCase();
            const wasImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
            const wasVideo = ['mp4', 'webm', 'mov'].includes(ext);
            
            // Show success toast
            showToast('success', `File "${truncateFilename(filename, 20)}" deleted successfully.`);
            
            // Check if we're on a tab that might now be empty
            if ((currentFilterBeforeDeletion === 'image' && wasImage) ||
                (currentFilterBeforeDeletion === 'video' && wasVideo) ||
                (currentFilterBeforeDeletion === 'other' && !wasImage && !wasVideo)) {
                
                // Check if we just deleted the last file in this category
                if (data && data.counts) {
                    const relevantCount = wasImage ? data.counts.images : 
                                         wasVideo ? data.counts.videos : 
                                         data.counts.others;
                    
                    if (relevantCount === 0) {
                        console.log(`Deleted the last ${currentFilterBeforeDeletion} file, switching to 'all' tab`);
                        currentFilterBeforeDeletion = 'all';
                    }
                }
            }
            
            // Important: Reload the gallery with the same filter that was active
            loadGallery(currentFilterBeforeDeletion, 1); // Reset to page 1
            
            // Also update the filter in the URL to maintain state
            const newUrl = new URL(window.location);
            newUrl.searchParams.set('filter', currentFilterBeforeDeletion);
            window.history.pushState({}, '', newUrl);
            
            // Make sure the filter button stays active
            updateFilterButtonState(currentFilterBeforeDeletion);
        })
        .catch(error => {
            console.error('Error deleting file:', error);
            showToast('error', `Error deleting file: ${error.message}`);
        })
        .finally(() => {
            // Remove the loading spinner
            if (loadingEl.parentNode) {
                loadingEl.remove();
            }
        });
}

/**
 * Updates the active state of filter buttons
 * @param {string} activeFilter - The filter to set as active
 */
function updateFilterButtonState(activeFilter) {
        const filterButtons = document.querySelectorAll('.btn-filter');
        filterButtons.forEach(button => {
        if (button.dataset.filter === activeFilter) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        });
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
    // Get file extension to determine if it's a video or image
    const filename = selectedUrl.split('/').pop();
    const ext = filename.split('.').pop().toLowerCase();
    const isVideo = ['mp4', 'webm', 'mov'].includes(ext);
    
    // Truncate filename to prevent layout issues
    const truncatedFilename = truncateFilename(filename, 30);
    
    console.log(`Opening ${isVideo ? 'video' : 'image'}: ${filename} (${selectedUrl})`);

    if (isVideo) {
        showVideoModal(selectedUrl, filename, truncatedFilename);
    } else {
        showSingleImageModal(selectedUrl, filename, truncatedFilename);
    }
}

/**
 * Shows the image modal with ONLY the clicked image
 * Pauses background loading for better performance
 */
function showSingleImageModal(selectedUrl, filename, truncatedFilename) {
    // Start performance timer
    performanceMetrics.startTimer();
    
    // Pause background loading operations
    pauseBackgroundLoading();
    isModalOpen = true;
    
    const imageModal = document.getElementById('imageModal');
        const carouselImages = document.getElementById('carouselImages');
        const imageModalTitle = document.querySelector('#imageModal .modal-title');
        
    if (!carouselImages || !imageModal) {
            console.error('Image modal elements not found');
            return;
        }
        
    // Disable any carousel functionality
    const prevButton = imageModal.querySelector('.carousel-control-prev');
    const nextButton = imageModal.querySelector('.carousel-control-next');
    if (prevButton) prevButton.style.display = 'none';
    if (nextButton) nextButton.style.display = 'none';
    
    // Clear any existing content
        carouselImages.innerHTML = '';
        
    // Set modal title
        if (imageModalTitle) {
        imageModalTitle.textContent = truncatedFilename;
        imageModalTitle.title = filename;
    }
    
    // Update delete button
    updateModalButtons('imageModal', filename);
    
    // Create image container with loader
    const imageContainer = document.createElement('div');
    imageContainer.className = 'carousel-item active';
    imageContainer.innerHTML = `
        <div class="position-relative" style="min-height: 200px;">
            <div class="position-absolute top-50 start-50 translate-middle loader-spinner">
                <div class="spinner-border text-primary" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
            </div>
        </div>
    `;
    
    // Add to carousel
    carouselImages.appendChild(imageContainer);
    
    // Show the modal immediately
    const modalInstance = new bootstrap.Modal(imageModal);
    modalInstance.show();
    
    // Pre-load the image before adding it to the DOM
    const imgLoader = new Image();
    
    // Set up load event handlers
    imgLoader.onload = function() {
        // Record performance metric
        const loadTime = performanceMetrics.endTimer('Image modal load');
        performanceMetrics.recordImageLoad(loadTime);
        console.log(`Average image load time: ${performanceMetrics.getAverageImageLoadTime().toFixed(2)}ms`);
        
        console.log(`Image loaded successfully: ${selectedUrl}`);
        
        // Create and add the visible image
        const imgElement = document.createElement('img');
        imgElement.src = selectedUrl;
        imgElement.className = 'd-block w-100';
        imgElement.alt = filename;
        imgElement.style.opacity = '0';
        imgElement.style.transition = 'opacity 0.3s';
        
        // Remove spinner and add the image
        const spinnerDiv = imageContainer.querySelector('.loader-spinner');
        if (spinnerDiv) spinnerDiv.remove();
        
        // Clear container and add the image
        imageContainer.querySelector('.position-relative').appendChild(imgElement);
        
        // Trigger reflow for smoother animation
        void imgElement.offsetWidth;
        
        // Fade in the image
        imgElement.style.opacity = '1';
    };
    
    imgLoader.onerror = function() {
        console.error(`Failed to load image: ${selectedUrl}`);
        
        // Show error state
        imageContainer.innerHTML = `
            <div class="text-center p-5">
                <div class="text-danger mb-3">
                    <i class="bi bi-exclamation-triangle-fill" style="font-size: 3rem;"></i>
                </div>
                <h5>Error loading image</h5>
                <p class="text-muted">${selectedUrl}</p>
                <button class="btn btn-sm btn-outline-primary retry-button">
                    <i class="bi bi-arrow-clockwise"></i> Retry
                </button>
            </div>
        `;
        
        // Add retry button handler
        const retryButton = imageContainer.querySelector('.retry-button');
        if (retryButton) {
            retryButton.addEventListener('click', function() {
                showSingleImageModal(selectedUrl, filename, truncatedFilename);
            });
        }
    };
    
    // Add a timeout for very slow connections
    const loadTimeout = setTimeout(() => {
        if (!imgLoader.complete) {
            console.warn(`Image load timeout: ${selectedUrl}`);
            imgLoader.src = ''; // Cancel the current load
            
            // Show error with retry option
            imageContainer.innerHTML = `
                <div class="text-center p-5">
                    <div class="text-warning mb-3">
                        <i class="bi bi-clock-history" style="font-size: 3rem;"></i>
                    </div>
                    <h5>Image is taking too long to load</h5>
                    <p class="text-muted">The server might be busy or the image may be too large</p>
                    <button class="btn btn-sm btn-outline-primary retry-button">
                        <i class="bi bi-arrow-clockwise"></i> Retry
                    </button>
                </div>
            `;
            
            // Add retry button handler
            const retryButton = imageContainer.querySelector('.retry-button');
            if (retryButton) {
                retryButton.addEventListener('click', function() {
                    showSingleImageModal(selectedUrl, filename, truncatedFilename);
                });
            }
        }
    }, 15000); // 15 seconds timeout
    
    // Start loading the image
    imgLoader.src = selectedUrl;
    
    // Check if image is already cached
    if (imgLoader.complete) {
        console.log('Image already cached, loading immediately');
        clearTimeout(loadTimeout);
        imgLoader.onload();
    }

    // Add handler for modal close
    imageModal.addEventListener('hidden.bs.modal', function onModalClose() {
        isModalOpen = false;
        
        // Resume background loading after a short delay
        setTimeout(resumeBackgroundLoading, 300);
        
        // Remove this specific event listener to avoid duplicates
        imageModal.removeEventListener('hidden.bs.modal', onModalClose);
    });
}

/**
 * Shows the video modal with ONLY the clicked video
 * Pauses background loading for better performance
 */
function showVideoModal(url, filename, title = '') {
    // Trigger server-side thumbnail generation if needed
    getVideoThumbnail(filename).catch(err => {
        console.warn('Error generating thumbnail on video view:', err);
    });
    
    // Get the modal
    const videoModal = document.getElementById('videoModal');
    if (!videoModal) return;
    
    // Set loading state
    isModalOpen = true;
    loadingPaused = true;
    
    // Set the modal title
    const modalTitle = videoModal.querySelector('.modal-title');
    if (modalTitle) {
        modalTitle.textContent = title || filename || 'View Video';
    }

    // Clear previous video
    const videoContainer = videoModal.querySelector('.video-container');
    videoContainer.innerHTML = '';
    
    // Create a new video element
    const video = document.createElement('video');
    video.src = url;
    video.controls = true;
    video.autoplay = true;
    video.className = 'w-100 h-auto';
    videoContainer.appendChild(video);
    
    // Add loading indicator
                const loadingIndicator = document.createElement('div');
    loadingIndicator.className = 'position-absolute top-50 start-50 translate-middle';
                loadingIndicator.innerHTML = `
        <div class="spinner-border text-light" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
    `;
    videoContainer.appendChild(loadingIndicator);
    
    // Handle video loading events
    video.onloadeddata = function() {
        loadingIndicator.remove();
    };
    
    video.onerror = function() {
        loadingIndicator.remove();
        videoContainer.innerHTML = `
            <div class="alert alert-danger">
                <i class="bi bi-exclamation-triangle"></i>
                Error loading video
            </div>
        `;
    };
    
    // Show the modal
    const modal = new bootstrap.Modal(videoModal);
    modal.show();
    
    // Handle modal close
    videoModal.addEventListener('hidden.bs.modal', function () {
        // Stop the video when modal is closed
        videoContainer.innerHTML = '';
        
        // Reset loading state
        isModalOpen = false;
        loadingPaused = false;
        
        // Process any queued loading operations
        if (loadingQueue.length > 0) {
            console.log(`Processing ${loadingQueue.length} queued loading operations`);
            while (loadingQueue.length > 0) {
                const operation = loadingQueue.shift();
                operation();
            }
        }
    }, { once: true });
}

// Add this flag to track if initialization has been done
let appInitialized = false;

// Main initialization function
document.addEventListener('DOMContentLoaded', function() {
    // Check if forceReloadThumbnails is set in localStorage
    if (localStorage.getItem('forceReloadThumbnails') === 'true') {
        console.log('Force reloading thumbnails...');
        localStorage.removeItem('forceReloadThumbnails');
        localStorage.removeItem('lastUpdatedThumbnail');
        
        // Clear thumbnail cache
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('img_thumb_') || key.startsWith('thumb_') || key.startsWith('duration_')) {
                localStorage.removeItem(key);
            }
        }
    }
    
    // Create toast container if it doesn't exist
    if (!document.getElementById('toastContainer')) {
        const toastContainer = document.createElement('div');
        toastContainer.id = 'toastContainer';
        toastContainer.className = 'toast-container position-fixed bottom-0 end-0 p-3';
        toastContainer.style.zIndex = '5';
        document.body.appendChild(toastContainer);
    }
    
    // Create upload toast if it doesn't exist
    if (!document.getElementById('uploadToast')) {
        const uploadToast = document.createElement('div');
        uploadToast.id = 'uploadToast';
        uploadToast.className = 'toast align-items-center';
        uploadToast.setAttribute('role', 'alert');
        uploadToast.setAttribute('aria-live', 'assertive');
        uploadToast.setAttribute('aria-atomic', 'true');
        uploadToast.innerHTML = `
            <div class="d-flex">
                <div class="toast-body" id="toastMessage">
                </div>
                <button type="button" class="btn-close me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
        `;
        document.getElementById('toastContainer').appendChild(uploadToast);
    }
    
    // Get filter buttons
    const filterButtons = document.querySelectorAll('.btn-filter');
    
    // Handle filter button clicks with cache awareness
    filterButtons.forEach(button => {
        // Clone button to remove all event listeners
        const newButton = button.cloneNode(true);
        button.parentNode.replaceChild(newButton, button);
        
        // Add fresh event listener
        newButton.addEventListener('click', function() {
            // Remove 'clicked' class from all buttons
            filterButtons.forEach(btn => btn.classList.remove('clicked'));
            
            // Add 'clicked' class to this button
            this.classList.add('clicked');
            
            // Remove the class after animation completes
            setTimeout(() => {
                this.classList.remove('clicked');
            }, 500);
            
            // Store the filter being applied
            const targetFilter = this.dataset.filter;
            
            // Update active state
            filterButtons.forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');
            
            // Check if the button has a "force reload" data attribute
            const forceReload = this.dataset.forceReload === 'true';
            
            // Load gallery with this filter (use cache if available)
            loadGallery(targetFilter, 1, forceReload);
        });
    });

    // Add a debug button to clear cache if in development mode
    const devMode = localStorage.getItem('devMode') === 'true';
    if (devMode) {
        // Add clear cache button
        const filterContainer = document.querySelector('.filter-container');
        if (filterContainer) {
            const clearCacheBtn = document.createElement('button');
            clearCacheBtn.className = 'btn btn-sm btn-outline-danger ms-2';
            clearCacheBtn.innerHTML = '<i class="bi bi-trash"></i> Clear Cache';
            clearCacheBtn.onclick = function() {
                // Clear filter cache
                clearFilterCache();
                // Force reload current filter
                loadGallery(currentFilter, 1, true);
                console.log('Filter cache cleared');
                showToast('info', 'Filter cache cleared');
            };
            filterContainer.appendChild(clearCacheBtn);
        }
    }

    // Clear any existing gallery content
    const gallery = document.getElementById('gallery');
    if (gallery) {
        gallery.innerHTML = '';
    }

    // Use URL parameter first, then saved state
    const urlFilter = getUrlParameter('filter');
    const savedState = localStorage.getItem('appState');
    let initialFilter = 'all';

    if (urlFilter) {
        initialFilter = urlFilter;
    } else if (savedState) {
        try {
            const state = JSON.parse(savedState);
            initialFilter = state.currentFilter || 'all';
        } catch (e) {
            console.warn('Could not parse saved state', e);
        }
    }

    // Update active state
    updateFilterButtonState(initialFilter);
    
    // Load gallery only once - with cache awareness
    console.log(`Initial load with filter: ${initialFilter}`);
    loadGallery(initialFilter, 1, false);
    
    // Add Back to Top button
    addBackToTopButton();
    
    // Ensure scroll listener is attached only once
    window.removeEventListener('scroll', handleScroll);
    window.addEventListener('scroll', handleScroll);
    
    // Add click handler for loading indicators
    document.removeEventListener('click', handleLoadingIndicatorClick);
    document.addEventListener('click', handleLoadingIndicatorClick);

    // Add scroll direction detection
    window.removeEventListener('scroll', handleScrollDirection);
    window.addEventListener('scroll', handleScrollDirection);
    
    // Setup modal state tracking
    const singleImageModal = document.getElementById('singleImageModal');
    if (singleImageModal) {
        singleImageModal.addEventListener('show.bs.modal', () => {
            isModalOpen = true;
            pauseBackgroundLoading();
        });
        
        singleImageModal.addEventListener('hidden.bs.modal', () => {
            isModalOpen = false;
            resumeBackgroundLoading();
        });
    }
    
    const videoModal = document.getElementById('videoModal');
    if (videoModal) {
        videoModal.addEventListener('show.bs.modal', () => {
            isModalOpen = true;
            pauseBackgroundLoading();
        });
        
        videoModal.addEventListener('hidden.bs.modal', () => {
            isModalOpen = false;
            resumeBackgroundLoading();
        });
    }
    
    const addDebugTools = (localStorage.getItem('devMode') === 'true');
    if (addDebugTools) {
        addDevTools();
    }
});

// Add this function to handle loading indicator clicks
function handleLoadingIndicatorClick(event) {
    if (event.target.closest('.gallery-loading-indicator') || 
        event.target.closest('.scroll-loading-indicator')) {
        const indicator = event.target.closest('.gallery-loading-indicator') || 
                         event.target.closest('.scroll-loading-indicator');
        indicator.remove();
    }
}

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
function updateTabLabels(counts = {}) {
    const defaultCounts = {
        all: 0,
        images: 0,
        videos: 0,
        others: 0
    };
    
    // Merge with defaults to ensure all properties exist
    const mergedCounts = {...defaultCounts, ...counts};
    
    // If all individual counts are 0 but 'all' is not, calculate it
    if (mergedCounts.images === 0 && mergedCounts.videos === 0 && mergedCounts.others === 0 && mergedCounts.all > 0) {
        // This might happen if the server only provided the 'all' count
        console.warn('Individual counts are 0 but total is not, counts might be incomplete');
    } else if (mergedCounts.all === 0) {
        // If 'all' is 0, calculate it from the sum of individuals
        mergedCounts.all = mergedCounts.images + mergedCounts.videos + mergedCounts.others;
    }
    
    // Update the tab labels
    const allTab = document.querySelector('[data-filter="all"]');
    const imageTab = document.querySelector('[data-filter="image"]');
    const videoTab = document.querySelector('[data-filter="video"]');
    const otherTab = document.querySelector('[data-filter="other"]');

    if (allTab) allTab.textContent = `All (${mergedCounts.all})`;
    if (imageTab) imageTab.textContent = `Images (${mergedCounts.images})`;
    if (videoTab) videoTab.textContent = `Videos (${mergedCounts.videos})`;
    if (otherTab) otherTab.textContent = `Other (${mergedCounts.others})`;
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
                    <img src="${cachedThumbnail}" class="card-img-top" loading="lazy" data-url="${url}" data-filename="${filename}">
                    <span class="position-absolute bottom-0 end-0 badge bg-dark m-2">
                        ${duration}
                    </span>
                </div>
            </div>`;
        col.querySelector('img').addEventListener('click', function() {
            const url = this.getAttribute('data-url');
            const filename = this.getAttribute('data-filename');
            if (url && filename) {
                showImageModal(url, filename);
            } else {
                console.error('Missing URL or filename for clicked image');
            }
        });
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
                    placeholder.remove();
                });
            }
        }
    }
}

// Run cleanup every 10 seconds - longer interval to avoid conflicts
setInterval(cleanupPlaceholders, 10000);

/**
 * Processes files sequentially with a delay between each for a smoother appearance
 * Respects loading pauses for better performance during modal viewing
 */
async function processFilesSequentially(files, gallery, page) {
    // Get last modified dates and ensure they're sorted
    let filesWithDates = [...files]; // Create a copy to avoid modifying original array
    
    // Check if we need to fetch dates (old format) or if they're already there (new format)
    if (Array.isArray(filesWithDates) && filesWithDates.length > 0) {
        try {
            // If dates are missing, fetch them
            if (!filesWithDates[0].date) {
                console.log('Fetching file dates for sorting...');
                filesWithDates = await Promise.all(filesWithDates.map(async fileObj => {
                    const url = `/uploads/${fileObj.filename}`;
                    const response = await fetch(url, { method: 'HEAD' });
                    const lastModified = new Date(response.headers.get('last-modified'));
                    return { ...fileObj, date: lastModified };
                }));
            }
            
            // Always sort by date in descending order, regardless of format
            console.log('Sorting files by date (newest first)...');
            filesWithDates.sort((a, b) => {
                // Handle various date formats
                const dateA = a.date instanceof Date ? a.date : new Date(a.date || a.modified || 0);
                const dateB = b.date instanceof Date ? b.date : new Date(b.date || b.modified || 0);
                return dateB - dateA; // Descending order (newest first)
            });
        } catch (error) {
            console.warn('Error processing file dates:', error);
            // Continue with unsorted files
        }
    }
    
    // Create a document fragment for better performance
    const fragment = document.createDocumentFragment();
    
    // Keep track of processed filenames to prevent duplicates
    const processedFilenames = new Set();
    
    // Check for existing files in the gallery (to prevent duplicates on refresh)
    if (page === 1) {
        // If this is page 1, we want to clear any existing items to prevent duplicates
        const existingItems = gallery.querySelectorAll('.real-item');
        existingItems.forEach(item => {
            item.remove();
        });
    } else {
        // For subsequent pages, track what's already in the gallery
        const existingItems = gallery.querySelectorAll('.real-item');
        existingItems.forEach(item => {
            const filename = item.getAttribute('data-filename');
            if (filename) {
                processedFilenames.add(filename);
            }
        });
    }
    
    // Process each file with awareness of loading pauses
    for (let i = 0; i < filesWithDates.length; i++) {
        // If loading is paused, wait for it to resume
        if (loadingPaused) {
            // Create a promise that resolves when loading resumes
            await new Promise(resolve => {
                loadingQueue.push(() => {
                    resolve(); // Resume processing when queue is processed
                });
            });
        }
        
        const fileObj = filesWithDates[i];
        
        // Handle both old and new format
        const filename = fileObj.filename;
        
        // Skip if this file has already been processed
        if (processedFilenames.has(filename)) {
            console.log(`Skipping duplicate file: ${filename}`);
            continue;
        }
        
        // Mark this file as processed
        processedFilenames.add(filename);
        
        const ext = filename.split('.').pop().toLowerCase();
        const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
        const isVideo = ['mp4', 'webm', 'mov'].includes(ext);
        const url = `/uploads/${filename}`;
        
        // Process the file based on type
        const col = document.createElement('div');
        col.className = 'col-3 mb-3 real-item';
        col.setAttribute('data-filename', filename);
        
        if (isImage) {
            try {
                // Create a proper thumbnail container with loading spinner
                const thumbnailHtml = `
                    <div class="card h-100">
                        <div class="thumbnail-container">
                            <div class="thumbnail-loading">
                                <div class="spinner-border spinner-border-sm text-primary" role="status">
                                    <span class="visually-hidden">Loading...</span>
                                </div>
                            </div>
                            <img class="thumbnail-img" alt="${filename}">
                        </div>
                    </div>`;
                
                col.innerHTML = thumbnailHtml;
                
                // Get the img element to set up load handling
                const imgElement = col.querySelector('.thumbnail-img');
                const loadingElement = col.querySelector('.thumbnail-loading');
                
                // Set up click handler
                imgElement.onclick = () => showImageModal(url, filename, truncateFilename(filename, 30));
                
                // Check if thumbnail exists in cache
                const cachedThumbnail = localStorage.getItem(`img_thumb_${filename}`);
                
                if (cachedThumbnail) {
                    // Use cached thumbnail, but still show spinner until loaded
                    imgElement.onload = function() {
                        imgElement.classList.add('loaded');
                        if (loadingElement) loadingElement.style.display = 'none';
                    };
                    
                    imgElement.src = cachedThumbnail;
                    
                    // Handle case where image is already cached in browser
                    if (imgElement.complete) {
                        imgElement.classList.add('loaded');
                        if (loadingElement) loadingElement.style.display = 'none';
                    }
                } else {
                    // No cached thumbnail, generate one
                    createImageThumbnail(url).then(thumbnail => {
                        try {
                            localStorage.setItem(`img_thumb_${filename}`, thumbnail);
                        } catch (e) {
                            if (e.name === 'QuotaExceededError') {
                                clearOldThumbnails();
                            }
                        }
                        
                        // Set image source to the new thumbnail
                        imgElement.onload = function() {
                            imgElement.classList.add('loaded');
                            if (loadingElement) loadingElement.style.display = 'none';
                        };
                        
                        imgElement.src = thumbnail;
                    }).catch(e => {
                        console.warn('Error generating thumbnail:', e);
                        // Fallback to original image
                        imgElement.src = url;
                        if (loadingElement) loadingElement.style.display = 'none';
                    });
                }
                
                // Add to fragment - this is the key fix
                fragment.appendChild(col);
            } catch (e) {
                console.warn('Error handling image thumbnail:', e);
                // Fallback for error cases - make sure to still add to fragment
                col.innerHTML = `
                    <div class="card h-100">
                        <img src="${url}" class="card-img-top" loading="lazy" onclick="showImageModal('${url}')">
                    </div>`;
                fragment.appendChild(col);
            }
        } else if (isVideo) {
            try {
                // Create a thumbnail container with loading spinner
                const thumbnailHtml = `
                    <div class="card h-100">
                        <div class="thumbnail-container">
                            <div class="thumbnail-loading">
                                <div class="spinner-border spinner-border-sm text-primary" role="status">
                                    <span class="visually-hidden">Loading...</span>
                                </div>
                            </div>
                            <img class="thumbnail-img" alt="${filename}">
                            <div class="video-duration position-absolute bottom-0 end-0 badge bg-dark m-2"></div>
                        </div>
                    </div>`;
                
                col.innerHTML = thumbnailHtml;
                
                // Get elements
                const imgElement = col.querySelector('.thumbnail-img');
                const loadingElement = col.querySelector('.thumbnail-loading');
                const durationElement = col.querySelector('.video-duration');
                
                // Set up click handler
                col.querySelector('.thumbnail-container').onclick = () => showVideoModal(url, filename, truncateFilename(filename, 30));
                
                // Try to get server-side thumbnail first
                const serverThumbnail = await getVideoThumbnail(filename);
                
                if (serverThumbnail) {
                    // Use server-side thumbnail
                    imgElement.onload = function() {
                        imgElement.classList.add('loaded');
                        if (loadingElement) loadingElement.style.display = 'none';
                    };
                    
                    imgElement.src = serverThumbnail;
                    
                    // Get duration (we'll still need to get this from the video)
                    const video = document.createElement('video');
                    video.src = url;
                    video.preload = 'metadata';
                    video.onloadedmetadata = () => {
                        const duration = Math.round(video.duration);
                        const minutes = Math.floor(duration / 60);
                        const seconds = duration % 60;
                        const durationText = `${minutes}:${seconds.toString().padStart(2, '0')}`;
                        
                        if (durationElement) {
                            durationElement.textContent = durationText;
                        }
                    };
                    video.load();
                } else {
                    // Fall back to client-side thumbnail generation
                    // Check localStorage cache first
                    const cachedThumbnail = localStorage.getItem(`thumb_${filename}`);
                    const cachedDuration = localStorage.getItem(`duration_${filename}`);
                    
                    if (cachedThumbnail) {
                        // Use cached thumbnail
                        imgElement.onload = function() {
                            imgElement.classList.add('loaded');
                            if (loadingElement) loadingElement.style.display = 'none';
                        };
                        
                        imgElement.src = cachedThumbnail;
                        
                        // Add cached duration if available
                        if (cachedDuration && durationElement) {
                            durationElement.textContent = cachedDuration;
                        }
                    } else {
                        // Generate video thumbnail client-side
                        captureVideoFrame(url, function(thumbnail, duration) {
                            try {
                                localStorage.setItem(`thumb_${filename}`, thumbnail);
                                localStorage.setItem(`duration_${filename}`, duration);
                            } catch (e) {
                                if (e.name === 'QuotaExceededError') {
                                    clearOldThumbnails();
                                }
                            }
                            
                            // Set image source to the new thumbnail
                            imgElement.onload = function() {
                                imgElement.classList.add('loaded');
                                if (loadingElement) loadingElement.style.display = 'none';
                            };
                            
                            imgElement.src = thumbnail;
                            
                            // Add duration badge
                            if (durationElement) {
                                durationElement.textContent = duration;
                            }
                        });
                    }
                }
                
                // Add to fragment - this is the key fix
                fragment.appendChild(col);
            } catch (e) {
                console.warn('Error handling video thumbnail:', e);
                // Fallback for error cases - make sure to still add to fragment
                col.innerHTML = `
                    <div class="card h-100">
                        <div class="position-relative">
                            <div class="card-img-top bg-dark text-white d-flex align-items-center justify-content-center" style="height: 200px;">
                                <i class="bi bi-play-circle-fill" style="font-size: 2rem;"></i>
                            </div>
                        </div>
                    </div>`;
                fragment.appendChild(col);
            }
        } else {
            // Other file types (non-image, non-video)
            const fileHtml = `
                <div class="card h-100">
                    <div class="card-body text-center">
                        <i class="bi bi-file-earmark text-muted mb-2" style="font-size: 2rem;"></i>
                        <div class="small text-muted mb-2 text-truncate" title="${filename}">${filename}</div>
                        <a href="${url}" download class="btn btn-primary btn-sm">
                            <i class="bi bi-download"></i> Download
                        </a>
                    </div>
                </div>`;
            
            col.innerHTML = fileHtml;
            fragment.appendChild(col);
        }
        
        // Add a small delay between processing items, but only if not in modal
        if (!isModalOpen) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }
    
    // After all files are processed, append the fragment to the gallery
    gallery.appendChild(fragment);
    
    return fragment;
}

/**
 * Updates the delete and close buttons in the modal
 * Fixes double confirmation issue
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
    } else {
        // Clear existing buttons to avoid duplicate event handlers
        buttonContainer.innerHTML = '';
    }
    
    // Add delete button
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'btn btn-danger';
    deleteButton.innerHTML = '<i class="bi bi-trash"></i> Delete';
    
    // Use an anonymous function to create a closure for the deletion logic
    const deleteHandler = function(event) {
        // Prevent the event from triggering multiple times
        event.preventDefault();
        event.stopPropagation();
        
        // Remove the event listener immediately to prevent multiple calls
        deleteButton.removeEventListener('click', deleteHandler);
        
        // Close the modal first
        const modalInstance = bootstrap.Modal.getInstance(modal);
        if (modalInstance) modalInstance.hide();
        
        // Confirm deletion ONCE
        if (confirm(`Are you sure you want to delete "${filename}"?`)) {
            deleteFile(filename);
        }
    };
    
    // Add the event listener
    deleteButton.addEventListener('click', deleteHandler);
    buttonContainer.appendChild(deleteButton);
    
    // Add close button
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
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

// Add this to the videoModal shown.bs.modal event
document.getElementById('videoModal').addEventListener('shown.bs.modal', function() {
    // Pause any previously playing videos when opening a new one
    document.querySelectorAll('video').forEach(vid => {
        if (!this.contains(vid)) {
            vid.pause();
        }
    });
});

// Add this to the videoModal hidden.bs.modal event
document.getElementById('videoModal').addEventListener('hidden.bs.modal', function() {
    // Pause any videos in this modal when closing
    this.querySelectorAll('video').forEach(vid => {
        vid.pause();
    });
});

/**
 * Pauses background loading operations
 */
function pauseBackgroundLoading() {
    loadingPaused = true;
    console.log('Background loading paused');
}

/**
 * Resumes background loading operations
 */
function resumeBackgroundLoading() {
    loadingPaused = false;
    console.log('Background loading resumed');
    
    // Process any queued operations
    while (loadingQueue.length > 0 && !loadingPaused) {
        const operation = loadingQueue.shift();
        if (typeof operation === 'function') {
            operation();
        }
    }
}

/**
 * Adds an operation to the loading queue if loading is paused
 * @param {Function} operation - The operation to queue or execute
 * @returns {boolean} - True if executed immediately, false if queued
 */
function queueOrExecuteOperation(operation) {
    if (loadingPaused) {
        loadingQueue.push(operation);
        return false;
    } else {
        operation();
        return true;
    }
}

/**
 * Creates image thumbnail with awareness of loading pauses
 */
function generateAndCacheThumbnail(url, filename) {
    // If loading is paused, queue this operation
    if (loadingPaused) {
        return new Promise(resolve => {
            loadingQueue.push(async () => {
                const thumbnail = await createImageThumbnail(url);
                try {
                    localStorage.setItem(`img_thumb_${filename}`, thumbnail);
                } catch (e) {
                    if (e.name === 'QuotaExceededError') {
                        clearOldThumbnails();
                    }
                }
                resolve(thumbnail);
            });
        });
    }
    
    // Normal processing if not paused
    return createImageThumbnail(url).then(thumbnail => {
        try {
            localStorage.setItem(`img_thumb_${filename}`, thumbnail);
        } catch (e) {
            if (e.name === 'QuotaExceededError') {
                clearOldThumbnails();
            }
        }
        return thumbnail;
    });
}

/**
 * Captures video frame with awareness of loading pauses
 */
function captureVideoFrameWithPause(url, filename) {
    return new Promise((resolve) => {
        // If loading is paused, queue this operation
        if (loadingPaused) {
            loadingQueue.push(() => {
                captureVideoFrame(url, (thumbnail, duration) => {
                    try {
                        localStorage.setItem(`thumb_${filename}`, thumbnail);
                        localStorage.setItem(`duration_${filename}`, duration);
                    } catch (e) {
                        if (e.name === 'QuotaExceededError') {
                            clearOldThumbnails();
                        }
                    }
                    resolve({ thumbnail, duration });
                });
            });
        } else {
            captureVideoFrame(url, (thumbnail, duration) => {
                try {
                    localStorage.setItem(`thumb_${filename}`, thumbnail);
                    localStorage.setItem(`duration_${filename}`, duration);
                } catch (e) {
                    if (e.name === 'QuotaExceededError') {
                        clearOldThumbnails();
                    }
                }
                resolve({ thumbnail, duration });
            });
        }
    });
}

/**
 * Tracks and reports performance metrics
 */
const performanceMetrics = {
    startTime: 0,
    imageLoadTimes: [],
    
    startTimer: function() {
        this.startTime = performance.now();
    },
    
    endTimer: function(label) {
        const duration = performance.now() - this.startTime;
        console.log(`Performance: ${label} took ${duration.toFixed(2)}ms`);
        return duration;
    },
    
    recordImageLoad: function(duration) {
        this.imageLoadTimes.push(duration);
        // Keep only the last 20 measurements
        if (this.imageLoadTimes.length > 20) {
            this.imageLoadTimes.shift();
        }
    },
    
    getAverageImageLoadTime: function() {
        if (this.imageLoadTimes.length === 0) return 0;
        const sum = this.imageLoadTimes.reduce((a, b) => a + b, 0);
        return sum / this.imageLoadTimes.length;
    }
};

/**
 * Saves the current app state to localStorage
 */
function saveAppState() {
    const state = {
        currentFilter,
        currentPage,
        lastScrollPosition: window.scrollY
    };
    
    try {
        localStorage.setItem('appState', JSON.stringify(state));
    } catch (e) {
        console.warn('Could not save app state', e);
    }
}

/**
 * Restores the app state from localStorage
 * @param {boolean} loadContent - Whether to load content or just update state
 */
function restoreAppState(loadContent = true) {
    try {
        const savedState = localStorage.getItem('appState');
        if (savedState) {
            const state = JSON.parse(savedState);
            
            // Use URL parameter first, then saved state
            const urlFilter = getUrlParameter('filter');
            currentFilter = urlFilter || state.currentFilter || 'all';
            
            // Update UI to match
            updateFilterButtonState(currentFilter);
            
            // Only load gallery if explicitly requested
            // This prevents double-loading during initialization
            if (loadContent) {
                console.log(`Restoring gallery with filter: ${currentFilter}`);
                loadGallery(currentFilter, 1);
            } else {
                console.log(`Updated filter state to: ${currentFilter} (without loading content)`);
            }
        }
    } catch (e) {
        console.warn('Could not restore app state', e);
    }
}

// Call saveAppState when changing filters, pages, or closing the page
window.addEventListener('beforeunload', saveAppState);

// Call these functions when needed
document.addEventListener('DOMContentLoaded', restoreAppState);

// Add this function to check for and generate server-side thumbnails
async function getVideoThumbnail(filename) {
    // First, check if server thumbnail exists
    try {
        // Try to load thumbnail from server (using a head request to check if exists)
        const thumbnailUrl = `/thumbnails/${filename}.jpg`;
        const response = await fetch(thumbnailUrl, { method: 'HEAD' });
        
        if (response.ok) {
            // Server thumbnail exists
            return thumbnailUrl;
        }
        
        // If we get here, thumbnail doesn't exist on server, try to generate it
        console.log(`Requesting server to generate thumbnail for ${filename}`);
        const generateResponse = await fetch(`/generate-thumbnail/${filename}`);
        const result = await generateResponse.json();
        
        if (result.success) {
            // Server generated the thumbnail successfully
            return result.path;
        } else {
            // Server failed to generate thumbnail, fall back to client-side generation
            console.warn(`Server thumbnail generation failed for ${filename}: ${result.error}`);
            return null;
        }
    } catch (error) {
        console.warn(`Error checking/generating server thumbnail: ${error.message}`);
        return null;
    }
}

function periodicCleanup() {
    // Only run if not actively loading
    if (!isLoading) {
        // Clean up any stale loading indicators
        const staleIndicators = document.querySelectorAll('.loading-indicator');
        staleIndicators.forEach(indicator => {
            const timestamp = parseInt(indicator.dataset.timestamp);
            if (Date.now() - timestamp > 5000) { // 5 seconds old
                indicator.remove();
            }
        });
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
 * Creates a smaller set of placeholder thumbnails to show while loading content
 * @param {number} count - Number of placeholders to create
 * @returns {DocumentFragment} Fragment containing placeholder thumbnails
 */
function createPlaceholderThumbnails(count = 5) {
    // Create a document fragment for better performance
    const fragment = document.createDocumentFragment();
    
    for (let i = 0; i < count; i++) {
        const col = document.createElement('div');
        col.className = 'col-3 col-md-3 col-lg-2 col-xl-1 mb-3 placeholder-thumbnail';
        
        col.innerHTML = `
            <div class="card h-100">
                <div class="placeholder-content position-relative" style="aspect-ratio: 1/1; background: #f0f0f0;">
                    <div class="shimmer-effect"></div>
                    <div class="position-absolute top-50 start-50 translate-middle">
                        <div class="spinner-border text-primary" role="status">
                            <span class="visually-hidden">Loading...</span>
                        </div>
                    </div>
                </div>
                <div class="card-body p-2">
                    <div class="bg-light w-75 mb-1" style="height: 12px; border-radius: 3px;"></div>
                    <div class="bg-light w-50" style="height: 10px; border-radius: 3px;"></div>
                </div>
            </div>
        `;
        
        fragment.appendChild(col);
    }
    
    return fragment;
}

/**
 * Handles scroll events for infinite loading
 */
function handleScroll() {
    // Skip processing if a modal is open or loading is already in progress
    if (isModalOpen || isLoading) return;

    // Clear existing timeout
    if (scrollTimeout) {
        clearTimeout(scrollTimeout);
    }

    // Set new timeout
    scrollTimeout = setTimeout(() => {
        const scrollPosition = window.innerHeight + window.scrollY;
        const bodyHeight = document.body.offsetHeight;
        const threshold = 500; // Load more when user is 500px from bottom

        if (scrollPosition >= bodyHeight - threshold) {
            // If we've reached the end of content, show the message
            if (!hasMore) {
                const gallery = document.getElementById('gallery');
                if (gallery) {
                    showEndOfContentMessage(gallery);
                }
                return;
            }

            console.log(`Loading more files - Page ${currentPage + 1} for filter ${currentFilter}`);
            
            // If loading is paused, queue this operation
            if (loadingPaused) {
                console.log('Loading paused, queueing load operation');
                loadingQueue.push(() => loadGallery(currentFilter, currentPage + 1));
                return;
            }

            // Load the actual content
            loadGallery(currentFilter, currentPage + 1);
        }
    }, 100); // Debounce for 100ms
}

// Make sure this is outside any functions, at the global level
window.addEventListener('scroll', handleScroll);

/**
 * Handles scroll direction detection for cleanup
 */
function handleScrollDirection() {
    const st = window.pageYOffset || document.documentElement.scrollTop;
    lastScrollTop = st <= 0 ? 0 : st; // For Mobile or negative scrolling
}

// Make sure this is outside any functions, at the global level
window.addEventListener('scroll', handleScrollDirection);

// Function to clear the filter cache
function clearFilterCache() {
    for (const key in filterCache) {
        filterCache[key].loaded = false;
        filterCache[key].html = '';
        filterCache[key].currentPage = 0;
    }
    console.log('Filter cache cleared');
}

// Add a function to reattach event handlers to cached content
function reattachEventHandlers() {
    const gallery = document.getElementById('gallery');
    if (!gallery) return;
    
    console.log('Reattaching event handlers to cached content');
    
    // Reattach image click handlers - only select images inside thumbnail containers
    const imageItems = gallery.querySelectorAll('.real-item:not(:has(.video-duration))');
    imageItems.forEach(container => {
        const filename = container.getAttribute('data-filename');
        if (filename) {
            const url = `/uploads/${filename}`;
            const imgElement = container.querySelector('.thumbnail-img');
            if (imgElement) {
                imgElement.onclick = () => showSingleImageModal(url, filename, truncateFilename(filename, 30));
            }
        }
    });
    
    // Reattach video thumbnail click handlers - only select containers with video duration badges
    const videoItems = gallery.querySelectorAll('.real-item:has(.video-duration)');
    videoItems.forEach(container => {
        const filename = container.getAttribute('data-filename');
        if (filename) {
            const url = `/uploads/${filename}`;
            const thumbnailContainer = container.querySelector('.thumbnail-container');
            if (thumbnailContainer) {
                thumbnailContainer.onclick = () => showVideoModal(url, filename, truncateFilename(filename, 30));
            }
        }
    });
    
    // Fallback approach for browsers that don't support :has() selector
    gallery.querySelectorAll('.real-item').forEach(item => {
        const filename = item.getAttribute('data-filename');
        if (!filename) return;
        
        const url = `/uploads/${filename}`;
        const ext = filename.split('.').pop().toLowerCase();
        const isVideo = ['mp4', 'webm', 'mov'].includes(ext);
        
        if (isVideo) {
            const thumbnailContainer = item.querySelector('.thumbnail-container');
            if (thumbnailContainer) {
                thumbnailContainer.onclick = () => showVideoModal(url, filename, truncateFilename(filename, 30));
            }
        } else {
            const imgElement = item.querySelector('.thumbnail-img');
            if (imgElement) {
                imgElement.onclick = () => showSingleImageModal(url, filename, truncateFilename(filename, 30));
            }
        }
    });
}
