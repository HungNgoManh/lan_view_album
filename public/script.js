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

// Add these variables at the top of your script
let isLoading = false;
let currentPage = 1;
let hasMore = true;
let currentFilter = 'all';
let scrollTimeout = null;
let isLoadingGallery = false; // Add this variable for gallery loading state
let loadingPage = 1; // Add this to track which page is being loaded
let hasMoreItems = true; // Add this to track if there are more items
let itemsPerPage = 20; // Number of items to load per page

// Add this global variable to track scroll direction
let lastScrollTop = 0;

// Add these global variables at the top of your script
let isModalOpen = false;
let loadingPaused = false;
let loadingQueue = [];

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

// Add a scroll direction detection function
function handleScrollDirection() {
    const st = window.pageYOffset || document.documentElement.scrollTop;
    
    // If scrolling up and not currently loading, clean up indicators
    if (st < lastScrollTop && !isLoading) {
        cleanupAllLoadingIndicators();
    }
    
    lastScrollTop = st <= 0 ? 0 : st; // For Mobile or negative scrolling
}

/**
 * Handles scroll events for infinite loading
 */
function handleScroll() {
    // Skip processing if a modal is open or loading is already in progress
    if (isModalOpen || isLoadingGallery || !hasMoreItems) {
        // Debug log for skipped scroll handling
        console.log(`Scroll handler skipped: modal=${isModalOpen}, loading=${isLoadingGallery}, hasMore=${hasMoreItems}`);
        return;
    }

    // Clear existing timeout
    if (scrollTimeout) {
        clearTimeout(scrollTimeout);
    }

    // Set new timeout
    scrollTimeout = setTimeout(() => {
        const scrollPosition = window.innerHeight + window.scrollY;
        const bodyHeight = document.body.offsetHeight;
        const threshold = 500; // Reduced threshold to load more when user is 500px from bottom
        
        const distanceToBottom = bodyHeight - scrollPosition;
        console.log(`Scroll position: ${scrollPosition}, Body height: ${bodyHeight}, Distance to bottom: ${distanceToBottom}px`);

        if (distanceToBottom <= threshold) {
            console.log(`Loading more files - Page ${currentPage + 1} for filter ${currentFilter}`);
            
            // If loading is paused, queue this operation
            if (loadingPaused) {
                console.log('Loading paused, queueing load operation');
                loadingQueue.push(() => loadGallery(currentFilter, currentPage + 1));
                return;
            }

            // Add placeholder thumbnails (no text header)
            const gallery = document.getElementById('gallery');
            if (gallery) {
                // Add exactly 5 placeholder thumbnails
                const placeholders = createPlaceholderThumbnails(5);
                gallery.appendChild(placeholders);
            }
            
            // Load the actual content
            currentPage++; // Increment the current page
            loadGallery(currentFilter, currentPage);
        }
    }, 100); // Debounce for 100ms
}

// Make sure this is outside any functions, at the global level
window.addEventListener('scroll', handleScroll);

// Update the loadGallery function to work with server thumbnails
function loadGallery(filter = 'all', page = 1) {
    console.log('Loading gallery with filter:', filter, 'page:', page);
    
    // If already loading, don't make another request
    if (isLoadingGallery) {
        console.log('Already loading gallery, ignoring request');
        return;
    }
    
    isLoadingGallery = true;
    isLoading = true; // Set the global loading flag
    loadingPage = page;
    currentPage = page; // Keep currentPage in sync with loadingPage
    currentFilter = filter;
    
    // Update debug display if it exists
    if (typeof updateDebugDisplay === 'function') {
        updateDebugDisplay();
    }
    
    // Show loading indicator for first page load
    if (page === 1) {
        showLoadingSpinner();
        
        // Clear any existing "end of content" message when starting a new search
        removeEndOfContentMessage();
    } else {
        // For pagination, add a loading indicator at the bottom
        createLoadingIndicator();
    }
    
    // Create placeholders for the incoming batch
    if (page > 1) {
        createPlaceholderThumbnails(5);
    }
    
    // Update filter button states
    updateFilterButtonState(filter);
    
    // Fetch files with filter and pagination - Always sort by date, newest first
    fetch(`/uploads?filter=${filter}&page=${page}&limit=${itemsPerPage}&sort=date&order=desc`)
        .then(res => {
            if (!res.ok) {
                throw new Error('Network response was not ok');
            }
            return res.json();
        })
        .then(data => {
            // Hide loading spinner for first page
            if (page === 1) {
                hideLoadingSpinner();
            }
            
            const gallery = document.getElementById('gallery');
            
            // Clear gallery for first page load
            if (page === 1) {
                gallery.innerHTML = '';
                
                // If no files returned for first page, show empty state
                if (data.files.length === 0) {
                    gallery.innerHTML = `
                        <div class="col-12 text-center py-5 w-100">
                            <div class="empty-state">
                                <i class="bi bi-inbox"></i>
                                <h5>No files found</h5>
                                <p>Upload some files to see them here</p>
                                <button class="btn btn-primary" onclick="document.getElementById('upload-tab').click()">
                                    <i class="bi bi-upload"></i> Upload Files
                                </button>
                            </div>
                        </div>
                    `;
                }
            }
            
            // Process the returned files
            processGalleryData(data, gallery, page, filter);
            
            // Update tab counts
            updateTabLabels(data.counts);
            
            // Save application state
            saveAppState();
            
            // Store hasMore for later use (infinite scrolling)
            hasMoreItems = data.hasMore;
            
            // Remove loading indicators
            removeLoadingIndicator();
            
            // Show "end of content" message when appropriate:
            // 1. There's no more data to load (!data.hasMore)
            // 2. AND we've successfully loaded some content in this request (data.files.length > 0)
            //    OR we already have content in the gallery from previous pages
            if (!data.hasMore) {
                const existingItems = gallery.querySelectorAll('.col-3:not(.placeholder-thumbnail)');
                const hasExistingContent = existingItems.length > 0;
                const hasNewContent = data.files && data.files.length > 0;
                
                console.log(`End of content check: hasMore=${data.hasMore}, existingItems=${existingItems.length}, newItems=${data.files ? data.files.length : 0}`);
                
                // Show end message if we have content (either existing or new) and there's no more to load
                if (hasExistingContent || hasNewContent) {
                    showNoMoreItemsIndicator();
                }
            }
            
            isLoadingGallery = false;
            isLoading = false; // Reset the global loading flag
            
            // Update debug display if it exists
            if (typeof updateDebugDisplay === 'function') {
                updateDebugDisplay();
            }
        })
        .catch(error => {
            console.error('Error loading gallery:', error);
            
            // Hide loading spinner in case of error
            hideLoadingSpinner();
            removeLoadingIndicator();
            
            // Show error toast
            showToast('error', 'Failed to load files. Please try again.');
            
            isLoadingGallery = false;
            isLoading = false; // Reset the global loading flag
            
            // Add retry button if first page load failed
            if (page === 1) {
            const gallery = document.getElementById('gallery');
                gallery.innerHTML = `
                    <div class="col-12 text-center">
                        <div class="alert alert-danger">
                            <p>Failed to load files</p>
                            <button class="btn btn-outline-danger" onclick="loadGallery('${filter}', 1)">
                                <i class="bi bi-arrow-clockwise"></i> Retry
                            </button>
                        </div>
                    </div>
                `;
            }
            
            // Update debug display if it exists
            if (typeof updateDebugDisplay === 'function') {
                updateDebugDisplay();
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
    // Remove placeholders
    const placeholders = gallery.querySelectorAll('.placeholder-thumbnail');
    placeholders.forEach(placeholder => placeholder.remove());
    
    // Check if there are no files to display
    if (!data.files || data.files.length === 0) {
        // Show empty state message for first page
        if (page === 1) {
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
                <div class="col-12 text-center py-5 w-100">
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
        } else if (!data.hasMore) {
            // For subsequent pages with no results, don't add any content
            // The end of content message will be handled by loadGallery function
            console.log('No more files to load for this filter');
        }
        
        // Nothing more to process
        return Promise.resolve();
    }
    
    // Process files with the existing function
    return processFilesSequentially(data.files, gallery, page);
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
    const ext = selectedUrl.split('.').pop().toLowerCase();
    const isVideo = ['mp4', 'webm', 'mov'].includes(ext);
    const filename = selectedUrl.split('/').pop();

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
    // Pause background loading for better performance
    pauseBackgroundLoading();
    
    // Set the modal open flag to prevent scroll loading
    isModalOpen = true;
    
    const imageModal = document.getElementById('imageModal');
    const modalTitle = imageModal.querySelector('.modal-title');
    const carousel = imageModal.querySelector('#carouselImages');
    
    // Set the modal title
    modalTitle.textContent = truncatedFilename || filename;
    
    // Clear previous items
    carousel.innerHTML = '';
    
    // Create a carousel item for the selected image
    const carouselItem = document.createElement('div');
    carouselItem.className = 'carousel-item active';
    
    // Add a loading indicator
    carouselItem.classList.add('loading');
    
    // Create the image element
    const imgElement = document.createElement('img');
    imgElement.className = 'd-block w-100';
    imgElement.alt = filename;
    
    // Set up loading events
    imgElement.onload = function() {
        carouselItem.classList.remove('loading');
        carouselItem.classList.add('loaded');
        
        // Always generate thumbnail after the image is successfully loaded
        console.log('Image loaded successfully, generating thumbnail');
        checkAndGenerateThumbnail(filename, selectedUrl)
            .then(thumbUrl => {
                console.log(`Thumbnail generated successfully: ${thumbUrl}`);
            })
            .catch(err => {
                console.error('Error generating thumbnail:', err);
            });
    };
    
    imgElement.onerror = function() {
        carouselItem.classList.remove('loading');
        carouselItem.classList.add('error');
        carouselItem.innerHTML += `
            <div class="error-message">
                Failed to load image. <button class="btn btn-sm btn-light retry-button">Retry</button>
            </div>
        `;
        
        // Add retry button functionality
        const retryButton = carouselItem.querySelector('.retry-button');
        if (retryButton) {
            retryButton.addEventListener('click', function() {
                // Remove error message
                const errorMessage = carouselItem.querySelector('.error-message');
                if (errorMessage) errorMessage.remove();
                
                // Add loading class again
                carouselItem.classList.remove('error');
                carouselItem.classList.add('loading');
                
                // Try loading again with a cache-busting parameter
                imgElement.src = `${selectedUrl}?t=${Date.now()}`;
            });
        }
    };
    
    // Set the image source
    imgElement.src = selectedUrl;
    carouselItem.appendChild(imgElement);
    carousel.appendChild(carouselItem);
    
    // Initialize or refresh the modal
    if (!imageModal._bsModal) {
        imageModal._bsModal = new bootstrap.Modal(imageModal);
    }
    
    // Add delete button to modal footer (create the footer if it doesn't exist)
    let modalFooter = imageModal.querySelector('.modal-footer');
    if (!modalFooter) {
        modalFooter = document.createElement('div');
        modalFooter.className = 'modal-footer';
        imageModal.querySelector('.modal-content').appendChild(modalFooter);
    }
    
    modalFooter.innerHTML = `
        <button type="button" class="btn btn-danger delete-modal-btn">
            <i class="bi bi-trash"></i> Delete
        </button>
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
            <i class="bi bi-x-circle"></i> Close
        </button>
    `;
    
    // Add event listener to delete button
    const deleteBtn = modalFooter.querySelector('.delete-modal-btn');
    deleteBtn.addEventListener('click', function() {
        const confirmDelete = confirm(`Are you sure you want to delete ${truncatedFilename || filename}?`);
        if (confirmDelete) {
            deleteFile(filename);
            imageModal._bsModal.hide();
        }
    });
    
    // Show the modal
    imageModal._bsModal.show();
    
    // When modal is closed, ensure we clean up event listeners
    const onModalClose = function() {
        // Clean up event listeners
        deleteBtn.removeEventListener('click', deleteBtn.onclick);
        imageModal.removeEventListener('hidden.bs.modal', onModalClose);
        
        // Reset modal open flag to allow scroll loading again
        isModalOpen = false;
        
        // Resume background loading
        resumeBackgroundLoading();
    };
    
    imageModal.addEventListener('hidden.bs.modal', onModalClose);
}

/**
 * Shows the video modal with ONLY the clicked video
 * Pauses background loading for better performance
 */
function showVideoModal(selectedUrl, filename, truncatedFilename) {
    // Pause background loading for better performance
    pauseBackgroundLoading();
    
    // Set the modal open flag to prevent scroll loading
    isModalOpen = true;
    
    const videoModal = document.getElementById('videoModal');
    const modalTitle = videoModal.querySelector('.modal-title');
    const carousel = videoModal.querySelector('#carouselVideos');
    
    // Set the modal title
    modalTitle.textContent = truncatedFilename || filename;
    
    // Clear previous items
    carousel.innerHTML = '';
    
    // Create a carousel item for the selected video
    const carouselItem = document.createElement('div');
    carouselItem.className = 'carousel-item active loading';
    
    // Create the video element
    const videoElement = document.createElement('video');
    videoElement.className = 'd-block w-100';
    videoElement.controls = true;
    videoElement.autoplay = true;
    
    // CRITICAL FIX: Extract just the filename without path for server operations
    const filenameOnly = filename.includes('/') ? 
        filename.substring(filename.lastIndexOf('/') + 1) : filename;
    
    // Check if the filename has a proper video extension before generating the thumbnail
    const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
    if (['.mp4', '.webm', '.mov', '.avi', '.mkv'].includes(ext)) {
        console.log(`Force generating thumbnail for video: ${filenameOnly} (extension: ${ext})`);
        
        // First, explicitly generate the thumbnail for this video
        // Use a timeout to ensure this happens independently of other operations
        setTimeout(() => {
            fetch(`/generate-thumbnail/${filenameOnly}`, {
                method: 'POST'
            })
            .then(res => {
                if (!res.ok) {
                    throw new Error(`Server returned ${res.status} ${res.statusText}`);
                }
                return res.json();
            })
            .then(data => {
                if (data.success) {
                    console.log(`Successfully generated thumbnail for video ${filenameOnly}`, data);
                    
                    // Calculate correct baseName for thumbnail lookup
                    const baseName = filenameOnly.substring(0, filenameOnly.lastIndexOf('.'));
                    const expectedThumbnailPath = `/thumbnails/${baseName}.jpg`;
                    
                    // Log details about the path for debugging
                    console.log(`Expected thumbnail path: ${expectedThumbnailPath}`);
                    console.log(`Server returned thumbnail path: ${data.thumbnail}`);
                    
                    // Update any instances in the gallery
                    updateThumbnailInGallery(filename, data.thumbnail);
                    
                    // Set flag to force thumbnail reload on next page load
                    localStorage.setItem('forceReloadThumbnails', 'true');
                    localStorage.setItem('lastUpdatedThumbnail', filename);
                    
                    // Verify the thumbnail was created by checking its existence
                    fetch(`${data.thumbnail}?t=${Date.now()}`, { method: 'HEAD' })
                        .then(headRes => {
                            if (headRes.ok) {
                                console.log(`Thumbnail exists at: ${data.thumbnail}`);
                            } else {
                                console.warn(`Thumbnail was generated but not found at: ${data.thumbnail}`);
                            }
                        });
                } else {
                    console.error(`Failed to generate thumbnail for video ${filenameOnly}:`, data.error || 'Unknown error');
                }
            })
            .catch(err => {
                console.error(`Error generating thumbnail for video ${filenameOnly}:`, err);
            });
        }, 100);
    } else {
        console.warn(`File ${filename} doesn't appear to be a supported video format (ext: ${ext})`);
    }
    
    // Set up loading and error events
    videoElement.addEventListener('loadeddata', function() {
        carouselItem.classList.remove('loading');
        carouselItem.classList.add('loaded');
    });
    
    videoElement.addEventListener('error', function() {
        carouselItem.classList.remove('loading');
        carouselItem.classList.add('error');
        carouselItem.innerHTML += `
            <div class="error-message">
                Failed to load video. <button class="btn btn-sm btn-light retry-button">Retry</button>
            </div>
        `;
        
        // Add retry button functionality
        const retryButton = carouselItem.querySelector('.retry-button');
        if (retryButton) {
            retryButton.addEventListener('click', function() {
                // Remove error message
                const errorMessage = carouselItem.querySelector('.error-message');
                if (errorMessage) errorMessage.remove();
                
                // Add loading class again
                carouselItem.classList.remove('error');
                carouselItem.classList.add('loading');
                
                // Try loading again with a cache-busting parameter
                videoElement.src = `${selectedUrl}?t=${Date.now()}`;
            });
        }
    });
    
    // Set the video source
    videoElement.src = selectedUrl;
    carouselItem.appendChild(videoElement);
    carousel.appendChild(carouselItem);
    
    // Initialize or refresh the modal
    if (!videoModal._bsModal) {
        videoModal._bsModal = new bootstrap.Modal(videoModal);
    }
    
    // Add delete button to modal footer (create the footer if it doesn't exist)
    let modalFooter = videoModal.querySelector('.modal-footer');
    if (!modalFooter) {
        modalFooter = document.createElement('div');
        modalFooter.className = 'modal-footer';
        videoModal.querySelector('.modal-content').appendChild(modalFooter);
    }
    
    modalFooter.innerHTML = `
        <button type="button" class="btn btn-danger delete-modal-btn">
            <i class="bi bi-trash"></i> Delete
        </button>
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
            <i class="bi bi-x-circle"></i> Close
        </button>
    `;
    
    // Add event listener to delete button
    const deleteBtn = modalFooter.querySelector('.delete-modal-btn');
    deleteBtn.addEventListener('click', function() {
        const confirmDelete = confirm(`Are you sure you want to delete ${truncatedFilename || filename}?`);
        if (confirmDelete) {
            deleteFile(filename);
            videoModal._bsModal.hide();
        }
    });
    
    // Show the modal
    videoModal._bsModal.show();
    
    // When modal is closed, ensure we clean up event listeners and stop video playback
    const onModalClose = function() {
        // When modal is closed, generate thumbnail one more time to ensure it exists
        if (['.mp4', '.webm', '.mov', '.avi', '.mkv'].includes(ext)) {
            console.log(`Regenerating thumbnail for ${filenameOnly} on modal close`);
            fetch(`/generate-thumbnail/${filenameOnly}`, {
                method: 'POST'
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    console.log(`Successfully generated thumbnail for ${filenameOnly} on modal close`);
                    // Set flag to force reload thumbnails on next page load
                    localStorage.setItem('forceReloadThumbnails', 'true');
                }
            })
            .catch(err => {
                console.error(`Error generating thumbnail on modal close: ${err}`);
            });
        }
    
        // Stop video playback
        const videoPlayer = carousel.querySelector('video');
        if (videoPlayer) {
            videoPlayer.pause();
            videoPlayer.currentTime = 0;
            videoPlayer.src = ''; // Clear the source to fully stop the video
        }
        
        // Clean up event listeners
        deleteBtn.removeEventListener('click', deleteBtn.onclick);
        videoModal.removeEventListener('hidden.bs.modal', onModalClose);
        
        // Reset modal open flag to allow scroll loading again
        isModalOpen = false;
        
        // Resume background loading
        resumeBackgroundLoading();
    };
    
    videoModal.addEventListener('hidden.bs.modal', onModalClose);
}

/**
 * Updates a thumbnail in the gallery
 * @param {string} filename - Filename to update thumbnail for
 * @param {string} thumbnailPath - Path to the new thumbnail
 */
function updateThumbnailInGallery(filename, thumbnailPath) {
    try {
        console.log(`Updating thumbnail in gallery for ${filename} with ${thumbnailPath}`);
        const gallery = document.getElementById('gallery');
        if (!gallery) return;
        
        // Find the column element with this filename
        const columns = gallery.querySelectorAll(`[data-filename="${filename}"]`);
        if (!columns || columns.length === 0) {
            console.log(`No gallery item found for ${filename}`);
            return;
        }
        
        // Add cache busting parameter
        const thumbnailUrl = `${thumbnailPath}?t=${Date.now()}`;
        
        columns.forEach(column => {
            // Find the thumbnail img element
            const img = column.querySelector('.thumbnail-img');
            if (img) {
                console.log(`Found img element for ${filename}, updating src to ${thumbnailUrl}`);
                img.src = thumbnailUrl;
                
                // Also update the cached thumbnail URL
                try {
                    localStorage.setItem(`thumb_${filename}`, thumbnailPath);
                } catch (e) {
                    console.warn(`Error updating cached thumbnail for ${filename}:`, e);
                }
            } else {
                console.log(`No thumbnail img found for ${filename}, creating one`);
                
                // Get the card container
                const card = column.querySelector('.card');
                if (!card) return;
                
                // Get the thumbnail container
                const thumbnailContainer = card.querySelector('.thumbnail-container');
                if (!thumbnailContainer) return;
                
                // Replace the current content with the new thumbnail
                const fileUrl = `/uploads/${filename}`;
                const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
                
                if (['.mp4', '.webm', '.mov', '.ogg'].includes(ext)) {
                    // For videos, keep the play button and duration badge
                    let duration = localStorage.getItem(`duration_${filename}`);
                    if (!duration) duration = "0:00";
                    
                    thumbnailContainer.innerHTML = `
                        <img src="${thumbnailUrl}" class="thumbnail-img card-img-top" loading="lazy" data-url="${fileUrl}" data-filename="${filename}">
                        <span class="position-absolute bottom-0 end-0 badge bg-dark m-2">
                            ${duration}
                        </span>
                        <div class="position-absolute" style="top: 0; left: 0; right: 0; bottom: 0; display: flex; justify-content: center; align-items: center; pointer-events: none;">
                            <i class="bi bi-play-circle-fill text-white" style="font-size: 2rem; opacity: 0.8;"></i>
                        </div>
                    `;
                    
                    // Attach video click handler
                    attachVideoClickHandler(thumbnailContainer, fileUrl, filename);
                } else {
                    // For images, just show the thumbnail
                    thumbnailContainer.innerHTML = `
                        <img src="${thumbnailUrl}" class="thumbnail-img card-img-top" loading="lazy" data-url="${fileUrl}" data-filename="${filename}">
                    `;
                    
                    // Attach image click handler
                    const newImg = thumbnailContainer.querySelector('.thumbnail-img');
                    if (newImg) {
                        newImg.addEventListener('click', function() {
                            showSingleImageModal(fileUrl, filename, truncateFilename(filename, 15));
                        });
                    }
                }
                
                // Cache the thumbnail URL
                try {
                    localStorage.setItem(`thumb_${filename}`, thumbnailPath);
                } catch (e) {
                    // If storage is full, clear old thumbnails and try again
                    clearOldThumbnails();
                    try {
                        localStorage.setItem(`thumb_${filename}`, thumbnailPath);
                    } catch (e2) {
                        console.warn(`Failed to cache thumbnail for ${filename}:`, e2);
                    }
                }
            }
        });
    } catch (err) {
        console.error(`Error updating thumbnail in gallery for ${filename}:`, err);
    }
}

// Add this to your DOMContentLoaded event handler
document.addEventListener('DOMContentLoaded', function() {
    // Check if we need to force reload thumbnails after generating new ones
    const forceReloadThumbnails = localStorage.getItem('forceReloadThumbnails') === 'true';
    const lastUpdatedThumbnail = localStorage.getItem('lastUpdatedThumbnail');
    
    if (forceReloadThumbnails) {
        console.log('Force reloading thumbnails due to new generated thumbnails');
        
        // Clear the flags to avoid repeated reloads
        localStorage.removeItem('forceReloadThumbnails');
        localStorage.removeItem('lastUpdatedThumbnail');
        
        // Remove all thumbnail caches to force fresh loads
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
            if (key.startsWith('thumb_') || key.startsWith('img_thumb_') || key.startsWith('duration_')) {
                console.log(`Clearing cached thumbnail: ${key}`);
                localStorage.removeItem(key);
            }
        });
        
        // Add a timestamp parameter to all image elements to force a fresh load
        setTimeout(() => {
            const allThumbnails = document.querySelectorAll('img.thumbnail-img, img.card-img-top');
            console.log(`Refreshing ${allThumbnails.length} thumbnails with cache-busting`);
            
            allThumbnails.forEach(img => {
                if (img.src && !img.src.startsWith('data:')) {
                    const currentSrc = img.src.split('?')[0]; // Remove any existing query params
                    img.src = `${currentSrc}?t=${Date.now()}`;
                }
            });
        }, 500); // Short delay to ensure DOM has loaded
    }
    
    // Clear any existing event handlers from filter buttons
    const filterButtons = document.querySelectorAll('.btn-filter');
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
            
            // Load gallery with this filter
            loadGallery(targetFilter, 1);
        });
    });

    // Load gallery with filter from URL on page load
    const filter = getUrlParameter('filter') || 'all';
    loadGallery(filter, 1);
    
    // Ensure the correct filter button is active
    updateFilterButtonState(filter);
    
    // Add Back to Top button
    addBackToTopButton();
    
    // Ensure scroll listeners are attached properly
    // First remove any existing listeners to avoid duplicates
    window.removeEventListener('scroll', handleScroll);
    window.removeEventListener('scroll', handleScrollDirection);
    
    // Now add them back
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('scroll', handleScrollDirection, { passive: true });
    
    console.log('Scroll event listeners initialized');
    
    // Reset state flags
    isLoading = false;
    isLoadingGallery = false;
    isModalOpen = false;
    
    document.addEventListener('click', function(event) {
        // Check if click was on a loading indicator or its close button
        if (event.target.closest('.gallery-loading-indicator') || 
            event.target.closest('.scroll-loading-indicator')) {
            const indicator = event.target.closest('.gallery-loading-indicator') || 
                              event.target.closest('.scroll-loading-indicator');
            indicator.remove();
        }
    });

    // Remove debug buttons if they exist
    const loadMoreDebugBtn = document.getElementById('loadMoreDebug');
    if (loadMoreDebugBtn) loadMoreDebugBtn.remove();
    
    const cleanupBtn = document.getElementById('cleanupPlaceholdersBtn');
    if (cleanupBtn) cleanupBtn.remove();

    // Set up modal events for proper state tracking
    setupModalEvents();
    
    // Add debug tools if in development mode
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        addDebugTools();
        console.log('Debug tools added');
    }
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
    // First check if a server-side thumbnail exists
    const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
    
    // Extract just the filename without any path components
    const filenameOnly = filename.includes('/') ? 
        filename.substring(filename.lastIndexOf('/') + 1) : 
        filename;
    
    // Get the base name without extension for thumbnail lookup
    const baseName = filenameOnly.substring(0, filenameOnly.lastIndexOf('.'));
    
    // The server thumbnail path should use the base filename without extension
    const serverThumbnailPath = `/thumbnails/${baseName}.jpg`;
    
    console.log(`Video thumbnail lookup: filename=${filename}, baseName=${baseName}, path=${serverThumbnailPath}`);
    
    // Try server-side thumbnail first with cache busting
    fetch(`${serverThumbnailPath}?t=${Date.now()}`, { method: 'HEAD' })
        .then(response => {
            if (response.ok) {
                console.log(`Using existing server thumbnail for video ${filename}`);
                // Server thumbnail exists, use it
                const thumbnailUrl = `${serverThumbnailPath}?t=${Date.now()}`;
                
                // Get duration from localStorage if available
                let duration = localStorage.getItem(`duration_${filename}`);
                if (!duration) {
                    duration = "0:00"; // Default duration if not cached
                    
                    // Try to get actual duration
                    const video = document.createElement('video');
                    video.src = url;
                    video.onloadedmetadata = function() {
                        const seconds = Math.floor(video.duration);
                        const minutes = Math.floor(seconds / 60);
                        const remainingSeconds = seconds % 60;
                        duration = `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
                        localStorage.setItem(`duration_${filename}`, duration);
                        
                        // Update duration in UI if element exists
                        const durationSpan = containerElement.querySelector('.video-duration');
                        if (durationSpan) {
                            durationSpan.textContent = duration;
                        }
                    };
                    video.load();
                }
                
                // Replace the placeholder with the actual thumbnail
                containerElement.innerHTML = `
                    <div class="card h-100">
                        <div class="thumbnail-container position-relative">
                            <img src="${thumbnailUrl}" class="thumbnail-img card-img-top" loading="lazy" data-url="${url}" data-filename="${filename}">
                            <span class="position-absolute bottom-0 end-0 badge bg-dark m-2 video-duration">
                                ${duration}
                            </span>
                            <div class="position-absolute" style="top: 0; left: 0; right: 0; bottom: 0; display: flex; justify-content: center; align-items: center; pointer-events: none;">
                                <i class="bi bi-play-circle-fill text-white" style="font-size: 2rem; opacity: 0.8;"></i>
                            </div>
                        </div>
                    </div>`;
                
                // Add click handler
                attachVideoClickHandler(containerElement.querySelector('.thumbnail-container'), url, filename);
            } else {
                console.log(`No server thumbnail found for video ${filename}, generating one`);
                // No server thumbnail, try to generate one
                fetch(`/generate-thumbnail/${filenameOnly}`, { method: 'POST' })
                    .then(res => res.json())
                    .then(data => {
                        if (data.success) {
                            console.log(`Successfully generated server thumbnail for video ${filename}`, data);
                            // Use the server-generated thumbnail with cache-busting
                            const thumbnailUrl = `${data.thumbnail}?t=${Date.now()}`;
                            
                            // Store this successful thumbnail URL for debugging
                            try {
                                localStorage.setItem('lastThumbnailUrl', thumbnailUrl);
                                localStorage.setItem('lastThumbnailFile', filenameOnly);
                            } catch (e) {
                                console.warn('Error storing debug info:', e);
                            }
                            
                            // Get or generate duration
                            const video = document.createElement('video');
                            video.src = url;
                            video.onloadedmetadata = function() {
                                const seconds = Math.floor(video.duration);
                                const minutes = Math.floor(seconds / 60);
                                const remainingSeconds = seconds % 60;
                                const duration = `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
                                
                                // Cache the duration
                                localStorage.setItem(`duration_${filename}`, duration);
                                
                                // Update the thumbnail in the UI
                                containerElement.innerHTML = `
                                    <div class="card h-100">
                                        <div class="thumbnail-container position-relative">
                                            <img src="${thumbnailUrl}" class="thumbnail-img card-img-top" loading="lazy" data-url="${url}" data-filename="${filename}">
                                            <span class="position-absolute bottom-0 end-0 badge bg-dark m-2">
                                                ${duration}
                                            </span>
                                            <div class="position-absolute" style="top: 0; left: 0; right: 0; bottom: 0; display: flex; justify-content: center; align-items: center; pointer-events: none;">
                                                <i class="bi bi-play-circle-fill text-white" style="font-size: 2rem; opacity: 0.8;"></i>
                                            </div>
                                        </div>
                                    </div>`;
                                
                                // Also force the thumbnail to be updated in the gallery
                                updateThumbnailInGallery(filename, data.thumbnail);
                                
                                // Set flag to force thumbnail reload
                                localStorage.setItem('forceReloadThumbnails', 'true');
                                localStorage.setItem('lastUpdatedThumbnail', filename);
                                
                                // Add click handler
                                attachVideoClickHandler(containerElement.querySelector('.thumbnail-container'), url, filename);
                            };
                            
                            // Force load video metadata
                            video.load();
                            
                            // If metadata loading fails, still show the thumbnail with a default duration
                            video.onerror = function() {
                                console.warn(`Could not load video metadata for ${filename}`);
                                containerElement.innerHTML = `
                                    <div class="card h-100">
                                        <div class="thumbnail-container position-relative">
                                            <img src="${thumbnailUrl}" class="thumbnail-img card-img-top" loading="lazy" data-url="${url}" data-filename="${filename}">
                                            <span class="position-absolute bottom-0 end-0 badge bg-dark m-2">
                                                0:00
                                            </span>
                                            <div class="position-absolute" style="top: 0; left: 0; right: 0; bottom: 0; display: flex; justify-content: center; align-items: center; pointer-events: none;">
                                                <i class="bi bi-play-circle-fill text-white" style="font-size: 2rem; opacity: 0.8;"></i>
                                            </div>
                                        </div>
                                    </div>`;
                                
                                // Also force the thumbnail to be updated in the gallery
                                updateThumbnailInGallery(filename, data.thumbnail);
                                
                                // Add click handler
                                attachVideoClickHandler(containerElement.querySelector('.thumbnail-container'), url, filename);
                            };
                        } else {
                            // Fall back to client-side thumbnail generation if server fails
                            console.warn(`Failed to generate server thumbnail for ${filename}. Falling back to client-side generation.`);
                            generateClientSideVideoThumbnail(url, filename, containerElement);
                        }
                    })
                    .catch(err => {
                        console.error(`Error generating server thumbnail for ${filename}:`, err);
                        // Fall back to client-side thumbnail generation
                        generateClientSideVideoThumbnail(url, filename, containerElement);
                    });
            }
        })
        .catch(err => {
            console.error(`Error checking server thumbnail for ${filename}:`, err);
            // Fall back to client-side thumbnail generation
            generateClientSideVideoThumbnail(url, filename, containerElement);
        });
}

/**
 * Helper function to attach click handler to video thumbnails
 */
function attachVideoClickHandler(thumbnailContainer, url, filename) {
    if (thumbnailContainer) {
        thumbnailContainer.addEventListener('click', function(event) {
            // Only trigger if the click wasn't on a button or link
            if (!event.target.closest('button') && !event.target.closest('a')) {
                showVideoModal(url, filename, truncateFilename(filename));
            }
        });
    }
}

/**
 * Client-side video thumbnail generation (fallback)
 */
function generateClientSideVideoThumbnail(url, filename, containerElement) {
    console.log(`Generating client-side thumbnail for video ${filename}`);
    // Create a video element
    const video = document.createElement('video');
    video.src = url;
    video.crossOrigin = 'anonymous';
    
    // Get or set video duration
    let duration = localStorage.getItem(`duration_${filename}`);
    
    // Set up video metadata loading
    video.onloadedmetadata = function() {
        console.log(`Video metadata loaded for ${filename}, duration: ${video.duration}`);
        
        // Calculate and cache duration
        const seconds = Math.floor(video.duration);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        duration = `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
        localStorage.setItem(`duration_${filename}`, duration);
        
        // When video can play, capture a frame for thumbnail
        video.currentTime = 1.0; // Skip to 1 second mark for thumbnail
    };
    
    // Handle errors with video loading
    video.onerror = function() {
        console.error(`Error loading video for thumbnail: ${filename}`, video.error);
        
        // Create a placeholder for error
        containerElement.innerHTML = `
            <div class="card h-100">
                <div class="thumbnail-container position-relative">
                    <div class="d-flex justify-content-center align-items-center bg-light w-100 h-100">
                        <i class="bi bi-film text-dark" style="font-size: 2rem;"></i>
                    </div>
                    <span class="position-absolute bottom-0 end-0 badge bg-dark m-2">
                        ${duration || '0:00'}
                    </span>
                    <div class="position-absolute" style="top: 0; left: 0; right: 0; bottom: 0; display: flex; justify-content: center; align-items: center; pointer-events: none;">
                        <i class="bi bi-play-circle-fill text-white" style="font-size: 2rem; opacity: 0.8;"></i>
                    </div>
                </div>
            </div>`;
        
        // Add click handler despite error
        attachVideoClickHandler(containerElement.querySelector('.thumbnail-container'), url, filename);
    };
    
    // When the time updates (after seeking to currentTime), capture the frame
    video.ontimeupdate = function() {
        if (video.readyState >= 2) { // Has enough data to capture frame
            try {
                // Create canvas to capture video frame
                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                
                // Draw the video frame to canvas
                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                
                // Get data URL from canvas
                let thumbnailUrl;
                try {
                    thumbnailUrl = canvas.toDataURL('image/jpeg', 0.7);
                    
                    // Save to localStorage if not too large (avoid quota issues)
                    if (thumbnailUrl.length < 100000) { // Only cache if less than ~100KB
                        try {
                            localStorage.setItem(`thumb_${filename}`, thumbnailUrl);
                        } catch (e) {
                            console.warn('Cannot store thumbnail in localStorage:', e);
                            // Try clearing space
                            clearOldThumbnails();
                        }
                    }
                } catch (e) {
                    console.error('Could not generate thumbnail for cross-origin video:', e);
                    thumbnailUrl = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMjIyIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyNCIgZmlsbD0iI2ZmZiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSI+VmlkZW88L3RleHQ+PC9zdmc+';
                }
                
                // Update the container with the thumbnail
                containerElement.innerHTML = `
                    <div class="card h-100">
                        <div class="thumbnail-container position-relative">
                            <img src="${thumbnailUrl}" class="thumbnail-img card-img-top" loading="lazy" data-url="${url}" data-filename="${filename}">
                            <span class="position-absolute bottom-0 end-0 badge bg-dark m-2">
                                ${duration || '0:00'}
                            </span>
                            <div class="position-absolute" style="top: 0; left: 0; right: 0; bottom: 0; display: flex; justify-content: center; align-items: center; pointer-events: none;">
                                <i class="bi bi-play-circle-fill text-white" style="font-size: 2rem; opacity: 0.8;"></i>
                            </div>
                        </div>
                    </div>`;
                
                // Add click handler
                attachVideoClickHandler(containerElement.querySelector('.thumbnail-container'), url, filename);
                
                // Cleanup
                video.pause();
                video.src = '';
                video.remove();
            } catch (error) {
                console.error('Error generating client-side thumbnail:', error);
                
                // Show a fallback image
                containerElement.innerHTML = `
                    <div class="card h-100">
                        <div class="thumbnail-container position-relative">
                            <div class="d-flex justify-content-center align-items-center bg-light w-100 h-100">
                                <i class="bi bi-film text-dark" style="font-size: 2rem;"></i>
                            </div>
                            <span class="position-absolute bottom-0 end-0 badge bg-dark m-2">
                                ${duration || '0:00'}
                            </span>
                            <div class="position-absolute" style="top: 0; left: 0; right: 0; bottom: 0; display: flex; justify-content: center; align-items: center; pointer-events: none;">
                                <i class="bi bi-play-circle-fill text-white" style="font-size: 2rem; opacity: 0.8;"></i>
                            </div>
                        </div>
                    </div>`;
                
                // Add click handler despite error
                attachVideoClickHandler(containerElement.querySelector('.thumbnail-container'), url, filename);
                
                // Cleanup
                video.pause();
                video.src = '';
                video.remove();
            }
        }
    };
    
    // Start video loading
    video.load();
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
 * Creates placeholder thumbnails for loading state
 * @param {number} count - Number of placeholders to create
 * @returns {DocumentFragment} Fragment containing the placeholders
 */
function createPlaceholderThumbnails(count = 5) {
    const fragment = document.createDocumentFragment();
    
    for (let i = 0; i < count; i++) {
        const column = document.createElement('div');
        column.className = 'col-3 col-md-3 col-lg-2 col-xl-1 mb-3 placeholder-thumbnail';
        
        column.innerHTML = `
            <div class="card h-100">
                <div class="thumbnail-container">
                    <div class="placeholder-content d-flex justify-content-center align-items-center" style="height: 150px; background-color: #f8f9fa;">
                        <div class="spinner-border text-primary" role="status">
                            <span class="visually-hidden">Loading...</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        fragment.appendChild(column);
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
    
    // Check if the gallery has actual content before showing the message
    const actualContent = gallery.querySelectorAll('.col-3');
    if (actualContent.length === 0) {
        console.log('Not showing end message because no actual content exists');
        return; // Don't show the message if there's no actual content
    }
    
    console.log(`Showing end of content message (${actualContent.length} items displayed)`);
    const indicator = document.createElement('div');
    indicator.className = 'col-12 text-center py-4 my-3 no-more-items w-100';
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
 * Function to force-clear all loading spinners after a timeout
 * This ensures thumbnails don't get stuck with spinners indefinitely
 */
function forceRemoveLoadingSpinners() {
    const spinners = document.querySelectorAll('.thumbnail-container .placeholder-content');
    console.log(`Force removing ${spinners.length} loading spinners`);
    
    spinners.forEach(spinner => {
        const container = spinner.closest('.thumbnail-container');
        if (container) {
            // Replace with error icon
            container.innerHTML = `
                <div class="d-flex justify-content-center align-items-center bg-light w-100 h-100" style="height: 150px;">
                    <i class="bi bi-image text-secondary" style="font-size: 2rem; opacity: 0.5;"></i>
                </div>`;
        }
    });
}

/**
 * Processes files sequentially with a delay between each for a smoother appearance
 * Uses server-side thumbnails for better performance
 */
async function processFilesSequentially(files, gallery, page) {
    console.log(`Processing ${files.length} files for page ${page}`);
    
    // Get last modified dates and ensure they're sorted
    let filesWithDates = [...files]; // Create a copy to avoid modifying original array
    
    // Check if we need to fetch dates (old format) or if they're already there (new format)
    if (Array.isArray(filesWithDates) && filesWithDates.length > 0) {
        try {
            // Check if date fields are present
            const hasDateField = filesWithDates[0].hasOwnProperty('date');
            const hasModifiedField = filesWithDates[0].hasOwnProperty('modified');
            
            console.log(`Files have date field: ${hasDateField}, modified field: ${hasModifiedField}`);
            
            // If dates are missing, fetch them
            if (!hasDateField && !hasModifiedField) {
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
                let dateA, dateB;
                
                if (a.date) {
                    dateA = a.date instanceof Date ? a.date : new Date(a.date);
                } else if (a.modified) {
                    dateA = new Date(a.modified);
                } else {
                    dateA = new Date(0); // Default to epoch if no date
                }
                
                if (b.date) {
                    dateB = b.date instanceof Date ? b.date : new Date(b.date);
                } else if (b.modified) {
                    dateB = new Date(b.modified);
                } else {
                    dateB = new Date(0); // Default to epoch if no date
                }
                
                return dateB - dateA; // Descending order (newest first)
            });
            
            // Log the first few dates for debugging
            console.log('Sorted dates (first 3 files):');
            filesWithDates.slice(0, 3).forEach((file, i) => {
                const dateStr = file.date ? new Date(file.date).toISOString() : 
                                file.modified ? new Date(file.modified).toISOString() : 'No date';
                console.log(`  [${i}] ${file.filename}: ${dateStr}`);
            });
        } catch (error) {
            console.warn('Error processing file dates:', error);
            // Continue with unsorted files
        }
    }
    
    // Create a document fragment for better performance
    const fragment = document.createDocumentFragment();
    
    // Create cards for each file
    for (let i = 0; i < filesWithDates.length; i++) {
        const fileObj = filesWithDates[i];
        const {filename, type} = fileObj;
        
        try {
            // Create a thumbnail container with loading spinner
            const col = document.createElement('div');
            col.className = 'col-3 col-md-3 col-lg-2 col-xl-1 mb-3';
            col.dataset.filename = filename;
            
            const card = document.createElement('div');
            card.className = 'card h-100';
            
            const thumbnailContainer = document.createElement('div');
            thumbnailContainer.className = 'thumbnail-container';
            
            // Add loading spinner
            const loadingSpinner = document.createElement('div');
            loadingSpinner.className = 'placeholder-content';
            loadingSpinner.innerHTML = '<div class="spinner-border text-primary" role="status" style="width: 2rem; height: 2rem;"></div>';
            thumbnailContainer.appendChild(loadingSpinner);
            
            // Use server thumbnail URL
            let thumbnailUrl;
            if (type === 'video') {
                const ext = filename.substring(filename.lastIndexOf('.'));
                const baseName = filename.substring(0, filename.lastIndexOf('.'));
                thumbnailUrl = `/thumbnails/${baseName}.jpg`;
                
                // For videos, we'll handle thumbnails differently
                const fileUrl = `/uploads/${filename}`;
                
                // Add to fragment first to prevent layout shifts
                card.appendChild(thumbnailContainer);
                col.appendChild(card);
                fragment.appendChild(col);
                
                // Generate video thumbnail separately to avoid blocking UI
                setTimeout(() => {
                    generateVideoThumbnail(fileUrl, filename, col);
                }, 50);
                
                // Move to next file
                continue;
            } else {
                thumbnailUrl = `/thumbnails/${filename}`;
            }
            
            // Create and set up the image element
            const imgElement = document.createElement('img');
            imgElement.className = 'thumbnail-img card-img-top';
            imgElement.alt = filename;
            imgElement.setAttribute('data-filename', filename);
            
            // Set up click handler based on file type
            if (type === 'image') {
                thumbnailContainer.style.cursor = 'pointer';
                thumbnailContainer.onclick = function() {
                    showSingleImageModal(`/uploads/${filename}`, filename, truncateFilename(filename));
                };
            } else {
                // For other files, just show download
                thumbnailContainer.style.cursor = 'pointer';
                thumbnailContainer.onclick = function() {
                    window.open(`/uploads/${filename}`, '_blank');
                };
            }
            
            // Add a cache-busting parameter to ensure fresh thumbnails
            const cacheBuster = Date.now();
            
            // Set up image loading
            imgElement.onload = function() {
                // Hide loading spinner and show image
                loadingSpinner.style.display = 'none';
                imgElement.classList.add('loaded');
                
                // Cache the thumbnail URL for faster loading next time
                try {
                    localStorage.setItem(`thumb_${filename}`, thumbnailUrl);
                } catch (e) {
                    // Handle quota exceeded errors
                    console.warn('Could not cache thumbnail, localStorage quota exceeded:', e);
                }
            };
            
            imgElement.onerror = function() {
                console.warn(`Error loading thumbnail for ${filename}, attempting to generate it`);
                // If thumbnail loading fails, try to generate it
                fetch(`/generate-thumbnail/${filename}`, { method: 'POST' })
                    .then(res => res.json())
                    .then(data => {
                        if (data.success) {
                            console.log(`Successfully generated thumbnail for ${filename}`);
                            // Retry loading the new thumbnail with a cache buster
                            const newThumbUrl = `${data.thumbnail}?t=${Date.now()}`;
                            imgElement.src = newThumbUrl;
                            
                            // Save to localStorage for future loads
                            try {
                                localStorage.setItem(`thumb_${filename}`, data.thumbnail);
                            } catch (e) {
                                console.warn('Could not cache thumbnail URL:', e);
                            }
                        } else {
                            // If generation fails, show a placeholder
                            console.error(`Failed to generate thumbnail for ${filename}:`, data.message || 'Unknown error');
                            loadingSpinner.style.display = 'none';
                            imgElement.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjBmMGYwIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyNCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSI+Tm8gUHJldmlldzwvdGV4dD48L3N2Zz4=';
                            imgElement.classList.add('loaded');
                        }
                    })
                    .catch(err => {
                        console.error(`Error during thumbnail generation for ${filename}:`, err);
                        // Show error placeholder
                        loadingSpinner.style.display = 'none';
                        imgElement.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjhkN2RhIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyNCIgZmlsbD0iI2RjMzU0NSIgdGV4dC1hbmNob3I9Im1pZGRsZSI+RXJyb3I8L3RleHQ+PC9zdmc+';
                            imgElement.classList.add('loaded');
                    });
            };
            
            // Always add cache-busting to force a fresh load
            imgElement.src = `${thumbnailUrl}?t=${cacheBuster}`;
            thumbnailContainer.appendChild(imgElement);
            
            // First add the thumbnail container to the card
            card.appendChild(thumbnailContainer);
            
            // Add the complete card to the column
            col.appendChild(card);
            
            // Add to the document fragment
            fragment.appendChild(col);
            
        } catch (error) {
            console.error(`Error processing ${filename}:`, error);
            
            // Create an error card as a fallback
            const errorCol = document.createElement('div');
            errorCol.className = 'col-3 col-md-3 col-lg-2 col-xl-1 mb-3';
            errorCol.dataset.filename = filename;
            
            const errorCard = document.createElement('div');
            errorCard.className = 'card h-100 border-danger';
            errorCard.innerHTML = `
                <div class="thumbnail-container">
                    <div class="d-flex justify-content-center align-items-center bg-light w-100 h-100">
                        <i class="bi bi-exclamation-triangle text-danger" style="font-size: 2rem;"></i>
                    </div>
                </div>
            `;
            
            errorCol.appendChild(errorCard);
            fragment.appendChild(errorCol);
        }
        
        // Add a small delay between processing each file to avoid blocking the UI
        if (i < filesWithDates.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }
    
    // Add all items to the gallery at once
    gallery.appendChild(fragment);
    
    // Clean up placeholders
    cleanupPlaceholders();
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
 */
function restoreAppState() {
    try {
        const savedState = localStorage.getItem('appState');
        if (savedState) {
            const state = JSON.parse(savedState);
            
            // Use URL parameter first, then saved state
            const urlFilter = getUrlParameter('filter');
            currentFilter = urlFilter || state.currentFilter || 'all';
            
            // Update UI to match
            updateFilterButtonState(currentFilter);
            
            // Load gallery with restored filter
            loadGallery(currentFilter, 1);
        }
    } catch (e) {
        console.warn('Could not restore app state', e);
    }
}

// Call saveAppState when changing filters, pages, or closing the page
window.addEventListener('beforeunload', saveAppState);

// Call these functions when needed
document.addEventListener('DOMContentLoaded', restoreAppState);

// Add these helper functions for loading indicators
function showLoadingSpinner() {
    const spinner = document.getElementById('loadingSpinner');
    if (spinner) {
        spinner.classList.remove('d-none');
    }
}

function hideLoadingSpinner() {
    const spinner = document.getElementById('loadingSpinner');
    if (spinner) {
        spinner.classList.add('d-none');
    }
}

function createLoadingIndicator() {
    const gallery = document.getElementById('gallery');
    
    // Check if a loading indicator already exists
    if (gallery.querySelector('.scroll-loading-indicator')) {
        return;
    }
    
    const loadingIndicator = document.createElement('div');
    loadingIndicator.className = 'col-12 scroll-loading-indicator text-center mb-4';
    loadingIndicator.innerHTML = `
        <div class="d-flex justify-content-center align-items-center">
            <div class="spinner-border text-primary me-2" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
            <div>Loading more items...</div>
        </div>
    `;
    
    gallery.appendChild(loadingIndicator);
}

function removeLoadingIndicator() {
    const gallery = document.getElementById('gallery');
    if (gallery) {
        const indicators = gallery.querySelectorAll('.scroll-loading-indicator, .gallery-loading-indicator');
        indicators.forEach(indicator => {
            indicator.classList.add('fade-out');
            setTimeout(() => {
                if (indicator.parentNode) {
                    indicator.remove();
                }
            }, 300);
        });
    }
}

/**
 * Helper function to test infinite scroll functionality
 * This will only be visible during debugging
 */
function addDebugTools() {
    // Create debug controls container if it doesn't exist
    if (!document.getElementById('debugControls')) {
        const debugContainer = document.createElement('div');
        debugContainer.id = 'debugControls';
        debugContainer.className = 'position-fixed bottom-0 start-0 m-3 p-3 bg-light rounded shadow';
        debugContainer.style.zIndex = '1050';
        debugContainer.innerHTML = `
            <h6>Debug Controls</h6>
            <div class="mb-2">
                <button id="loadNextPageBtn" class="btn btn-sm btn-primary">
                    Load Next Page
                </button>
                <button id="checkScrollStateBtn" class="btn btn-sm btn-info ms-2">
                    Check Scroll State
                </button>
            </div>
            <div class="small text-muted">
                <div>Current page: <span id="debugCurrentPage">0</span></div>
                <div>Filter: <span id="debugCurrentFilter">none</span></div>
                <div>Has more: <span id="debugHasMore">unknown</span></div>
                <div>Loading: <span id="debugIsLoading">false</span></div>
            </div>
        `;
        document.body.appendChild(debugContainer);
        
        // Add event listeners
        document.getElementById('loadNextPageBtn').addEventListener('click', function() {
            console.log(`Debug: Manually loading next page (${currentPage + 1})`);
            loadGallery(currentFilter, currentPage + 1);
        });
        
        document.getElementById('checkScrollStateBtn').addEventListener('click', function() {
            const scrollPosition = window.innerHeight + window.scrollY;
            const bodyHeight = document.body.offsetHeight;
            const distanceToBottom = bodyHeight - scrollPosition;
            
            console.log(`
Debug: Scroll State
-------------------
Current page: ${currentPage}
Current filter: ${currentFilter}
Has more items: ${hasMoreItems}
isLoading: ${isLoading}
isLoadingGallery: ${isLoadingGallery}
isModalOpen: ${isModalOpen}
Window height: ${window.innerHeight}px
Current scroll: ${window.scrollY}px
Scroll position: ${scrollPosition}px
Body height: ${bodyHeight}px
Distance to bottom: ${distanceToBottom}px
Scroll threshold: 500px
Will load more: ${distanceToBottom <= 500 && !isLoading && !isLoadingGallery && !isModalOpen && hasMoreItems}
            `);
            
            // Update debug display
            updateDebugDisplay();
        });
    }
    
    // Update the debug display with current values
    updateDebugDisplay();
}

/**
 * Updates the debug display with current state values
 */
function updateDebugDisplay() {
    const debugCurrentPage = document.getElementById('debugCurrentPage');
    const debugCurrentFilter = document.getElementById('debugCurrentFilter');
    const debugHasMore = document.getElementById('debugHasMore');
    const debugIsLoading = document.getElementById('debugIsLoading');
    
    if (debugCurrentPage) debugCurrentPage.textContent = currentPage;
    if (debugCurrentFilter) debugCurrentFilter.textContent = currentFilter;
    if (debugHasMore) debugHasMore.textContent = hasMoreItems;
    if (debugIsLoading) debugIsLoading.textContent = isLoading || isLoadingGallery;
}

/**
 * Sets up all modal events to properly track open/closed state
 * This function ensures that infinite scrolling works correctly
 */
function setupModalEvents() {
    // Get all modals in the document
    const modals = document.querySelectorAll('.modal');
    
    modals.forEach(modal => {
        // Add shown event listener
        modal.addEventListener('shown.bs.modal', function() {
            // Set modal open flag to prevent infinite scrolling
            isModalOpen = true;
            console.log(`Modal #${modal.id} opened, scroll loading paused`);
            
            // Mark carousel items as loading
            const items = this.querySelectorAll('.carousel-item');
            items.forEach(item => {
                item.classList.add('loading');
                
                // Add load event handlers for images
                const img = item.querySelector('img');
                if (img) {
                    img.onload = function() {
                        item.classList.remove('loading');
                    };
                    img.onerror = function() {
                        item.classList.remove('loading');
                        item.classList.add('load-error');
                        item.innerHTML += `<div class="error-message">Failed to load image</div>`;
                    };
                }
                
                // Add load event handlers for videos
                const video = item.querySelector('video');
                if (video) {
                    video.onloadeddata = function() {
                        item.classList.remove('loading');
                    };
                    video.onerror = function() {
                        item.classList.remove('loading');
                        item.classList.add('load-error');
                        item.innerHTML += `<div class="error-message">Failed to load video</div>`;
                    };
                }
            });
            
            // Update debug display if available
            if (typeof updateDebugDisplay === 'function') {
                updateDebugDisplay();
            }
        });
        
        // Add hidden event listener
        modal.addEventListener('hidden.bs.modal', function() {
            // Reset modal open flag to allow infinite scrolling again
            isModalOpen = false;
            console.log(`Modal #${modal.id} closed, scroll loading resumed`);
            
            // Update debug display if available
            if (typeof updateDebugDisplay === 'function') {
                updateDebugDisplay();
            }
        });
    });
    
    console.log(`Modal events set up for ${modals.length} modals`);
}

/**
 * Removes the "end of content" message
 */
function removeEndOfContentMessage() {
    const gallery = document.getElementById('gallery');
    if (!gallery) return;
    
    const endMessage = gallery.querySelector('.no-more-items');
    if (endMessage) {
        endMessage.remove();
    }
}

/**
 * Check if thumbnail exists and generate one if needed
 * @param {string} filename - Filename to check/generate thumbnail for
 * @param {string} [url] - URL of the file (unused by server, but kept for backward compatibility)
 * @returns {Promise<string>} - Promise resolving to thumbnail URL
 */
function checkAndGenerateThumbnail(filename, url = null) {
    return new Promise((resolve, reject) => {
        try {
            console.log(`checkAndGenerateThumbnail called for ${filename}`);
            
            // Get just the filename part if it contains a path
            const filenameOnly = filename.includes('/') ? 
                filename.substring(filename.lastIndexOf('/') + 1) : 
                filename;
                
            // Determine thumbnail path based on file type
            const ext = filenameOnly.substring(filenameOnly.lastIndexOf('.')).toLowerCase();
            const baseName = filenameOnly.substring(0, filenameOnly.lastIndexOf('.'));
            let thumbnailPath = `/thumbnails/${baseName}.jpg`;
            
            console.log(`Thumbnail path determined for ${filenameOnly}: ${thumbnailPath}`);
            
            // Add timestamp for cache busting
            const cacheBuster = Date.now();
            
            // First check if the thumbnail already exists
            fetch(`${thumbnailPath}?t=${cacheBuster}`, { method: 'HEAD' })
                .then(response => {
                    if (response.ok) {
                        console.log(`Thumbnail exists for ${filenameOnly} at ${thumbnailPath}`);
                        
                        // Update the thumbnail in the gallery with the existing path
                        updateThumbnailInGallery(filename, thumbnailPath);
                        
                        // Resolve with the existing thumbnail URL
                        resolve(`${thumbnailPath}?t=${cacheBuster}`);
                    } else {
                        console.log(`Thumbnail does not exist for ${filenameOnly}, generating...`);
                        
                        // Generate the thumbnail since it doesn't exist
                        fetch(`/generate-thumbnail/${filenameOnly}`, {
                            method: 'POST'
                        })
                        .then(res => res.json())
                        .then(data => {
                            if (data.success) {
                                console.log(`Thumbnail generated for ${filenameOnly}:`, data.thumbnail);
                                
                                // Update the thumbnail in the gallery
                                updateThumbnailInGallery(filename, data.thumbnail);
                                
                                // Force thumbnails to reload on next page load
                                localStorage.setItem('forceReloadThumbnails', 'true');
                                localStorage.setItem('lastUpdatedThumbnail', filename);
                                
                                // Clear any cached thumbnails for this file
                                try {
                                    localStorage.removeItem(`thumb_${filename}`);
                                    localStorage.removeItem(`img_thumb_${filename}`);
                                } catch (e) {
                                    console.warn(`Error clearing cached thumbnail: ${e.message}`);
                                }
                                
                                // Resolve with the new thumbnail URL
                                resolve(`${data.thumbnail}?t=${cacheBuster}`);
                            } else {
                                console.error(`Failed to generate thumbnail for ${filenameOnly}:`, data.error);
                                reject(new Error(`Failed to generate thumbnail: ${data.error}`));
                            }
                        })
                        .catch(err => {
                            console.error(`Error generating thumbnail for ${filenameOnly}:`, err);
                            reject(err);
                        });
                    }
                })
                .catch(err => {
                    console.error(`Error checking thumbnail existence for ${filenameOnly}:`, err);
                    reject(err);
                });
        } catch (err) {
            console.error(`Error in checkAndGenerateThumbnail for ${filename}:`, err);
            reject(err);
        }
    });
}
