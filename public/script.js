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
        bundle: false,
        headers: () => {
            return {
                'device-id': getOrCreateDeviceId()
            }
        }
    });

// Generate or retrieve a device ID for the current device
function getOrCreateDeviceId() {
    let deviceId = localStorage.getItem('device_id');
    
    if (!deviceId) {
        // Create a device ID based on browser fingerprint
        const userAgent = navigator.userAgent;
        const screenWidth = window.screen.width;
        const screenHeight = window.screen.height;
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const language = navigator.language;
        
        // Create a simple hash of these values
        const deviceSignature = `${userAgent}-${screenWidth}x${screenHeight}-${timeZone}-${language}`;
        
        // Create a simplified hash
        let hash = 0;
        for (let i = 0; i < deviceSignature.length; i++) {
            const char = deviceSignature.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        
        // Create a user-readable prefix
        const prefix = 'device';
        
        // Combine into final ID
        deviceId = `${prefix}_${Math.abs(hash).toString(16).substring(0, 8)}`;
        
        // Save for future use
        localStorage.setItem('device_id', deviceId);
        console.log(`Created new device ID: ${deviceId}`);
    }
    
    return deviceId;
}

// Track duplicate files for summary
let skippedDuplicateFiles = 0;

uppy.on('file-added', async (file) => {
    console.log(`Added file: ${file.name} (${file.size} bytes)`);

    // Check for duplicate files - get ALL files without pagination
    try {
        const response = await fetch('/uploads?checkDuplicates=true');
        const data = await response.json();
        
        // Extract filenames from the response
        const existingFiles = data && data.files && Array.isArray(data.files) 
            ? data.files.map(file => file.filename) 
            : [];
        
        console.log(`Checking for duplicates against existing files (${existingFiles.length}/${data?.counts?.all || 'unknown'} total files)`);
        console.log('Current file being checked:', file.name);
        
        // Get the device ID that will be used - same as what the server will use
        const deviceId = getOrCreateDeviceId();
        // What the filename would be when uploaded (same format as server would create)
        const potentialServerFilename = `${deviceId}_${file.name}`;
        console.log(`Potential server filename would be: ${potentialServerFilename}`);
        
        // Check if a file with the same name exists
        let isDuplicate = false;
        let duplicateFilename = '';
        
        // First check if the exact same filename exists (including device ID)
        if (existingFiles.includes(potentialServerFilename)) {
            console.log(`Found exact match for potential filename: ${potentialServerFilename}`);
            isDuplicate = true;
            duplicateFilename = potentialServerFilename;
        } else {
            // Otherwise check each file by extracting the original name
            for (const existingFile of existingFiles) {
                // Extract original filename part by finding the first underscore
                // This handles deviceId_filename.ext format properly
                const firstUnderscoreIndex = existingFile.indexOf('_');
                
                // If there's no underscore, compare the whole filename
                if (firstUnderscoreIndex === -1) {
                    console.log(`Comparing with file without underscore: "${existingFile}" vs "${file.name}"`);
                    if (existingFile === file.name) {
                        isDuplicate = true;
                        duplicateFilename = existingFile;
                        console.log(`Duplicate found! No underscore case: "${existingFile}" matches "${file.name}"`);
                        break;
                    }
                } else {
                    // Extract the part after the first underscore which should be the original filename
                    const existingOriginalName = existingFile.substring(firstUnderscoreIndex + 1);
                    console.log(`Comparing: "${existingOriginalName}" (from "${existingFile}") vs "${file.name}"`);
                    
                    // Compare with the file being uploaded
                    if (existingOriginalName === file.name) {
                        isDuplicate = true;
                        duplicateFilename = existingFile;
                        console.log(`Duplicate found! "${existingOriginalName}" matches "${file.name}"`);
                        break;
                    }
                }
            }
        }
        
        if (isDuplicate) {
            // Increment the counter for skipped files
            skippedDuplicateFiles++;
            
            // Show toast message
            const toastEl = document.getElementById('uploadToast');
            const toast = new bootstrap.Toast(toastEl);
            document.getElementById('toastMessage').textContent = `⚠️ Skipping file "${file.name}" as it already exists on server as "${duplicateFilename}"`;
            toast.show();
            
            // Remove the file from Uppy to prevent upload
            uppy.removeFile(file.id);
            console.log(`Removed duplicate file "${file.name}" from upload queue`);
            
            return; // Exit early as we removed the file
        } else {
            console.log(`No duplicates found for "${file.name}", proceeding with upload`);
        }
    } catch (error) {
        console.warn('Error checking for duplicates:', error);
        // Continue with upload even if duplicate check fails
    }
});

uppy.on('upload-success', (file, response) => {
    console.log(`Uploaded ${file.name} successfully`, response.body);
    
    // Check if the server flagged this as a duplicate
    if (response.body && response.body.isDuplicate) {
        console.log(`Server flagged ${file.name} as a duplicate!`, response.body);
        
        // Show toast message
        const toastEl = document.getElementById('uploadToast');
        const toast = new bootstrap.Toast(toastEl);
        document.getElementById('toastMessage').textContent = `⚠️ File "${file.name}" was uploaded but is a duplicate of an existing file.`;
        toast.show();
    } else {
        console.log(`Server did not flag ${file.name} as a duplicate`, response.body);
    }
    
    // Reload gallery when upload completes
    loadGallery(currentFilter, 1);
});

uppy.on('upload-error', (file, error, response) => {
    console.error(`Error uploading ${file.name}:`, error, response);
    
    // Show toast message for upload errors
    const toastEl = document.getElementById('uploadToast');
    const toast = new bootstrap.Toast(toastEl);
    
    // Extract error message from response if available
    let errorMessage = 'Upload failed';
    let isDuplicate = false;
    
    if (response) {
        if (response.body && response.body.message) {
            errorMessage = response.body.message;
        }
        if (response.body && response.body.isDuplicate) {
            isDuplicate = true;
        }
    } else if (error && error.message) {
        errorMessage = error.message;
    }
    
    // Use a specific icon for duplicate error
    const icon = isDuplicate ? '⚠️' : '❌';
    document.getElementById('toastMessage').textContent = `${icon} ${errorMessage}: ${file.name}`;
    
    // If this is a duplicate, increment the counter
    if (isDuplicate) {
        skippedDuplicateFiles++;
    }
    
    toast.show();
});

uppy.on('complete', (result) => {
    // Reset the counter when upload is complete
    const skippedFiles = skippedDuplicateFiles;
    skippedDuplicateFiles = 0;
    
    if (result.successful.length > 0 || skippedFiles > 0) {
        // Show toast message for successful upload
        const toastEl = document.getElementById('uploadToast');
        const toast = new bootstrap.Toast(toastEl);
        
        // Create a detailed message showing uploaded and skipped files
        let message = '';
        if (result.successful.length > 0) {
            message += `✅ ${result.successful.length} file(s) uploaded successfully! `;
        }
        if (skippedFiles > 0) {
            message += `⚠️ ${skippedFiles} duplicate file(s) were skipped.`;
        }
        
        document.getElementById('toastMessage').textContent = message;
        toast.show();

        // Force a fresh reload of the gallery with the current filter and page 1
        // This ensures new files appear at the top when sorted by date
        console.log("Upload complete - reloading gallery to show new files at top");
        
        // Clear any cached data that might prevent seeing new uploads
        hasMore = true; // Reset hasMore flag
        
        // Force reload current filter from page 1
        loadGallery(currentFilter, 1);
        
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

function createImageThumbnail(url) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous'; // Handle CORS if necessary
        img.onload = function() {
            const canvas = document.createElement('canvas');
            // Increase thumbnail size for better quality
            const maxSize = 400; // Increased from 300
            const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
            canvas.width = img.width * scale;
            canvas.height = img.height * scale;
            const context = canvas.getContext('2d');
            context.drawImage(img, 0, 0, canvas.width, canvas.height);
            // Higher quality JPEG compression
            const dataURL = canvas.toDataURL('image/jpeg', 0.85); // Increased from 0.7
            resolve(dataURL);
        };
        img.onerror = function(e) {
            console.error(`Error loading image for thumbnail: ${url}`, e);
            resolve(null); // Resolve with null on error
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

// Global Variables
let currentFilter = 'all';
let currentPage = 1;
let hasMore = true;
let isLoading = false;
let isModalOpen = false;
let scrollTimeout = null;
let isPaginationEnabled = true; // Controls whether to use pagination or infinite scroll
let filesPerPage = 20; // Fixed number of files per page (4 columns × 5 rows)
let totalFiles = 0;
let totalPages = 0;

// Add this global variable to track scroll direction
let lastScrollTop = 0;
let loadingPaused = false;
let loadingQueue = [];

// Add these variables at the top of your script file
let videoThumbnailQueue = [];
let isProcessingVideoThumbnails = false;
const MAX_CONCURRENT_VIDEO_THUMBNAILS = 2; // Limit concurrent video processing

// Update the loadGallery function to handle sequential loading
async function loadGallery(filter = 'all', page = 1) {
    // Prevent duplicate loading requests
    if (isLoading) {
        console.log(`Skipping duplicate loading request (filter: ${filter}, page: ${page})`);
        return;
    }
    isLoading = true;

    // Update current filter
    currentFilter = filter;
    currentPage = page;

    // Scroll to top when changing pages
    window.scrollTo({
        top: 0,
        behavior: 'smooth'
    });

    console.log(`Loading gallery with filter: ${filter}, page: ${page}`);

    // Get the gallery element
    const gallery = document.getElementById('gallery');
    
    // Show page loading indicator if not first page (for pagination mode)
    if (page > 1) {
        // Clear existing content when changing pages with pagination
        gallery.innerHTML = '';
        
        // Add loading indicator
        const loadingIndicator = document.createElement('div');
        loadingIndicator.id = 'pageLoadingIndicator';
        loadingIndicator.className = 'col-12 text-center py-5';
        loadingIndicator.innerHTML = `
            <div class="d-flex justify-content-center align-items-center">
                <div class="spinner-border text-primary" role="status">
                    <span class="visually-hidden">Loading page ${page}...</span>
                </div>
                <span class="ms-3">Loading page ${page}...</span>
            </div>
        `;
        gallery.appendChild(loadingIndicator);
    } 
    // Clear existing content if this is first page
    else if (gallery && page === 1) {
        // Clear existing content completely before adding new content
        gallery.innerHTML = '';
        
        // Add a single placeholder for first item
        const placeholder = createPlaceholderThumbnails(1);
        gallery.appendChild(placeholder);
    }

    // Disable filter buttons while loading
    const filterButtons = document.querySelectorAll('.btn-filter');
    filterButtons.forEach(btn => btn.disabled = true);

    // Update URL without reloading the page
    const newUrl = new URL(window.location);
    newUrl.searchParams.set('filter', filter);
    newUrl.searchParams.set('page', page);
    window.history.pushState({}, '', newUrl);

    // Set limit to 20 items per page for all tabs
    const limit = filesPerPage;

    try {
        // Fetch files with filter and pagination - explicitly request server-side sorting
        const sortParam = 'date';
        const orderParam = 'desc'; // desc = newest first
        console.log(`Requesting sorted data: sort=${sortParam}, order=${orderParam}`);
        
        const res = await fetch(`/uploads?filter=${filter}&page=${page}&limit=${limit}&sort=${sortParam}&order=${orderParam}`);
        
        if (!res.ok) {
            // Special handling for 500 errors when likely due to empty category
            if (res.status === 500 && ['image', 'video', 'other'].includes(filter)) {
                console.warn(`Server error for filter "${filter}", treating as empty category`);
                // Return a mock empty response
                return await processGalleryData({
                        files: [],
                        counts: {
                            all: 0,
                            images: 0,
                            videos: 0,
                            others: 0
                        },
                        hasMore: false,
                    page: page,
                    totalFiles: 0,
                    totalPages: 0
                }, gallery, page, filter);
            }
            
            throw new Error(`HTTP error! status: ${res.status}`);
        }
        
        const data = await res.json();
        
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
            page: page,
            totalFiles: 0,
            totalPages: 0
            };
            
            // Handle various response formats
            if (Array.isArray(data)) {
                // Old format: array of filenames
                standardizedData.files = data.map(filename => ({ filename }));
            standardizedData.hasMore = data.length >= limit;
            } else if (data && typeof data === 'object') {
                // New format with potential missing properties
                standardizedData.files = Array.isArray(data.files) ? data.files : [];
                standardizedData.counts = data.counts || standardizedData.counts;
                standardizedData.hasMore = data.hasMore !== undefined ? data.hasMore : false;
                standardizedData.page = data.page || page;
            standardizedData.totalFiles = data.totalFiles || standardizedData.files.length;
            standardizedData.totalPages = data.totalPages || 1;
            } else {
                console.warn(`Unexpected response format for filter "${filter}":`, data);
            }
            
            // Update app state with the standardized data
            currentPage = standardizedData.page;
            hasMore = standardizedData.hasMore;
        totalFiles = standardizedData.totalFiles;
        totalPages = standardizedData.totalPages;
            
            // Update tab labels with counts
            updateTabLabels(standardizedData.counts);
            
            // Process the gallery with standardized data
        await processGalleryData(standardizedData, gallery, page, filter);
    } catch (error) {
            console.error('Error loading gallery:', error);
            
            // If it's a 500 error and we're not on the "all" filter, switch to "all"
            if (error.message.includes('500') && filter !== 'all') {
                console.log(`Switching to 'all' filter due to server error`);
                showToast('warning', `Could not load ${filter} category, showing all files instead`);
                
                // Switch to all filter after a short delay
                setTimeout(() => {
                    currentFilter = 'all';
                    loadGallery('all', 1);
                    updateFilterButtonState('all');
                    
                    // Update URL
                    const newUrl = new URL(window.location);
                    newUrl.searchParams.set('filter', 'all');
                newUrl.searchParams.set('page', '1');
                    window.history.pushState({}, '', newUrl);
                }, 500);
                
                return;
            }
            
            // Remove placeholders
            const placeholders = gallery.querySelectorAll('.placeholder-thumbnail');
            placeholders.forEach(placeholder => placeholder.remove());
            
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
    } finally {
        // Make sure we remove the loading indicator
        const pageLoadingIndicator = document.getElementById('pageLoadingIndicator');
        if (pageLoadingIndicator) {
            pageLoadingIndicator.remove();
        }
            
            // Re-enable filter buttons
            filterButtons.forEach(btn => btn.disabled = false);
            
            // Reset loading flag
            isLoading = false;
            
            // Ensure the correct filter button is active
            updateFilterButtonState(filter);
        
        // Render pagination for all tabs
        // Clear existing pagination first to prevent stale DOM references
        const paginationContainer = document.getElementById('paginationContainer');
        const paginationWrapper = paginationContainer?.closest('.d-flex');
        
        if (paginationContainer) {
            paginationContainer.innerHTML = '';
            
            // Also remove any pagination info elements
            const existingInfo = paginationWrapper?.querySelector('.pagination-info');
            if (existingInfo) {
                existingInfo.remove();
            }
            
            // Make sure the container is visible
            if (paginationWrapper) {
                paginationWrapper.classList.remove('d-none');
            }
            
            // Now render the pagination
            renderPagination(totalPages, currentPage, filter);
        }
    }
}

// Update processGalleryData to handle one-by-one loading
async function processGalleryData(data, gallery, page, filter) {
    console.log(`Processing gallery data: ${data.files?.length || 0} files, page ${page}, filter ${filter}, total files: ${data.totalFiles}, total pages: ${data.totalPages}`);
    
    // Debug: Check if files have date information for sorting
    if (data.files && data.files.length > 0) {
        const hasDateInfo = data.files.some(file => file.date || file.modified);
        console.log(`Files have date information: ${hasDateInfo}`);
        
        // Log the first few files to check their date format
        console.log("Sample files with dates:");
        data.files.slice(0, 3).forEach((file, index) => {
            console.log(`File ${index+1}: ${file.filename}, Date: ${file.date || file.modified || 'No date'}`);
        });
    }
    
    // Clean up: Remove all placeholders first
    const allPlaceholders = gallery.querySelectorAll('.placeholder-thumbnail, .placeholder-row');
    allPlaceholders.forEach(placeholder => placeholder.remove());
    
    // Remove page loading indicator if it exists (for pagination)
    const pageLoadingIndicator = document.getElementById('pageLoadingIndicator');
    if (pageLoadingIndicator) {
        pageLoadingIndicator.remove();
    }
    
    // Check if there are no files to display
    if (!data.files || data.files.length === 0) {
        // If this is page 1, show empty state message
        if (page === 1) {
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
        }
        
        // Update hasMore flag
        hasMore = false;
        console.log('No more items to load');
        
        // Nothing more to process
        return Promise.resolve();
    }
    
    // Update hasMore flag based on the data
    hasMore = data.hasMore !== undefined ? data.hasMore : data.files.length >= filesPerPage;
    
    console.log(`Starting sequential processing of ${data.files.length} files`);
    
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
    
    // Process files in batches rather than one by one for better performance
    const batchSize = 5; // Process 5 files at once
    
    for (let i = 0; i < data.files.length; i += batchSize) {
        // Get the current batch of files
        const batch = data.files.slice(i, i + batchSize);
        
        // Process the batch in parallel
        await Promise.all(batch.map(async (fileObj) => {
            const filename = fileObj.filename;
            
            // Skip if this file has already been processed
            if (processedFilenames.has(filename)) {
                return;
            }
            
            // Mark this file as processed
            processedFilenames.add(filename);
            
            // Create the file card
            const fileCard = await createFileCardAsync(fileObj);
            
            // Add the file card to the gallery
            gallery.appendChild(fileCard);
        }));
        
        // No need for artificial delay between batches for better performance
    }
    
    // Remove all remaining placeholders
    const remainingPlaceholders = gallery.querySelectorAll('.placeholder-thumbnail');
    remainingPlaceholders.forEach(placeholder => placeholder.remove());
    
    // Return when all files are processed
    return Promise.resolve();
}

// Function to render pagination links
function renderPagination(totalPages, currentPage, filter) {
    const paginationContainer = document.getElementById('paginationContainer');
    if (!paginationContainer) return;
    
    // Make sure the container is visible
    const paginationWrapper = paginationContainer.closest('.d-flex');
    if (paginationWrapper) {
        paginationWrapper.classList.remove('d-none');
    }
    
    // Clear existing pagination
    paginationContainer.innerHTML = '';
    
    // If no pages or just one page, hide pagination
    if (!totalPages || totalPages <= 1) {
        if (paginationWrapper) {
            paginationWrapper.classList.add('d-none');
        }
        return;
    }
    
    // Create pagination info text
    const startItem = (currentPage - 1) * filesPerPage + 1;
    const endItem = Math.min(currentPage * filesPerPage, totalFiles);
    
    // Add "Previous" button
    const prevLi = document.createElement('li');
    prevLi.className = `page-item ${currentPage === 1 ? 'disabled' : ''}`;
    prevLi.innerHTML = `
        <a class="page-link" href="#" aria-label="Previous" 
           ${currentPage !== 1 ? `onclick="loadGallery('${filter}', ${currentPage - 1}); return false;"` : ''}>
            <span aria-hidden="true">&laquo;</span>
        </a>
    `;
    paginationContainer.appendChild(prevLi);
    
    // Determine which page numbers to show
    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, startPage + 4);
    
    // On mobile, show fewer page numbers
    const isMobile = window.innerWidth < 576;
    if (isMobile) {
        startPage = Math.max(1, currentPage - 1);
        endPage = Math.min(totalPages, startPage + 2);
    }
    
    // Adjust if we're near the end
    if (endPage - startPage < (isMobile ? 2 : 4)) {
        startPage = Math.max(1, endPage - (isMobile ? 2 : 4));
    }
    
    // Add first page if needed
    if (startPage > 1) {
        const firstLi = document.createElement('li');
        firstLi.className = 'page-item';
        firstLi.innerHTML = `
            <a class="page-link" href="#" onclick="loadGallery('${filter}', 1); return false;">1</a>
        `;
        paginationContainer.appendChild(firstLi);
        
        // Add ellipsis if needed
        if (startPage > 2) {
            const ellipsisLi = document.createElement('li');
            ellipsisLi.className = 'page-item ellipsis disabled';
            ellipsisLi.innerHTML = '<span class="page-link">...</span>';
            paginationContainer.appendChild(ellipsisLi);
        }
    }
    
    // Add page numbers
    for (let i = startPage; i <= endPage; i++) {
        const pageLi = document.createElement('li');
        pageLi.className = `page-item ${i === currentPage ? 'active' : ''}`;
        pageLi.innerHTML = `
            <a class="page-link" href="#" 
               ${i !== currentPage ? `onclick="loadGallery('${filter}', ${i}); return false;"` : ''}>
                ${i}
            </a>
        `;
        paginationContainer.appendChild(pageLi);
    }
    
    // Add last page if needed
    if (endPage < totalPages) {
        // Add ellipsis if needed
        if (endPage < totalPages - 1) {
            const ellipsisLi = document.createElement('li');
            ellipsisLi.className = 'page-item ellipsis disabled';
            ellipsisLi.innerHTML = '<span class="page-link">...</span>';
            paginationContainer.appendChild(ellipsisLi);
        }
        
        const lastLi = document.createElement('li');
        lastLi.className = 'page-item';
        lastLi.innerHTML = `
            <a class="page-link" href="#" onclick="loadGallery('${filter}', ${totalPages}); return false;">${totalPages}</a>
        `;
        paginationContainer.appendChild(lastLi);
    }
    
    // Add "Next" button
    const nextLi = document.createElement('li');
    nextLi.className = `page-item ${currentPage === totalPages ? 'disabled' : ''}`;
    nextLi.innerHTML = `
        <a class="page-link" href="#" aria-label="Next" 
           ${currentPage !== totalPages ? `onclick="loadGallery('${filter}', ${currentPage + 1}); return false;"` : ''}>
            <span aria-hidden="true">&raquo;</span>
        </a>
    `;
    paginationContainer.appendChild(nextLi);
    
    // Add pagination info above the pagination
    const paginationInfo = document.createElement('div');
    paginationInfo.className = 'pagination-info mb-2';
    paginationInfo.textContent = `Showing ${startItem}-${endItem} of ${totalFiles} files`;
    
    // Insert before pagination - Fix the insertBefore error
    if (paginationWrapper) {
        // First, remove any existing pagination info to prevent duplicates
        const existingInfo = paginationWrapper.querySelector('.pagination-info');
        if (existingInfo) {
            existingInfo.remove();
        }
        
        // Only try to insert if paginationContainer is still a child of paginationWrapper
        if (paginationContainer.parentNode === paginationWrapper) {
            paginationWrapper.insertBefore(paginationInfo, paginationContainer);
        } else {
            // If the container relationship has changed, just append it
            paginationWrapper.appendChild(paginationInfo);
        }
    }
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

    if (allTab) allTab.textContent = `All Files (${mergedCounts.all})`;
    if (imageTab) imageTab.textContent = `Photos (${mergedCounts.images})`;
    if (videoTab) videoTab.textContent = `Videos (${mergedCounts.videos})`;
}

// New function to process files one by one
async function processFilesOneByOne(files, gallery, page) {
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
    
    console.log(`Processing ${filesWithDates.length} files one by one...`);
    
    // Process files in batches rather than one by one for better performance
    const batchSize = 5; // Process 5 files at once
    
    for (let i = 0; i < filesWithDates.length; i += batchSize) {
        // Get the current batch of files
        const batch = filesWithDates.slice(i, i + batchSize);
        
        // Process the batch in parallel
        await Promise.all(batch.map(async (fileObj) => {
        const filename = fileObj.filename;
        
        // Skip if this file has already been processed
        if (processedFilenames.has(filename)) {
                return;
        }
        
        // Mark this file as processed
        processedFilenames.add(filename);
        
        // Create the file card
        const fileCard = await createFileCardAsync(fileObj);
        
        // Add the file card to the gallery
        gallery.appendChild(fileCard);
        }));
        
        // No need for artificial delay between batches for better performance
    }
    
    // Remove all remaining placeholders
    const remainingPlaceholders = gallery.querySelectorAll('.placeholder-thumbnail');
    remainingPlaceholders.forEach(placeholder => placeholder.remove());
    
    // Return when all files are processed
    return Promise.resolve();
}

// New function to create a file card with async/await
async function createFileCardAsync(fileObj) {
    const filename = fileObj.filename;
    const ext = filename.split('.').pop().toLowerCase();
    const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
    const isVideo = ['mp4', 'webm', 'mov'].includes(ext);
    const url = `/uploads/${filename}`;

    // Format file size
    const formatSize = (bytes) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    // Format date
    const formatDate = (date) => {
        return new Date(date).toLocaleString();
    };

    // Create table row for All tab
    const createTableRow = () => {
        const tr = document.createElement('tr');
        tr.className = 'file-row';
        tr.setAttribute('data-filename', filename);
        tr.style.display = 'flex';
        tr.style.width = '100%';

        const filenameTd = document.createElement('td');
        filenameTd.style.flex = '1';
        filenameTd.style.overflow = 'hidden';
        filenameTd.style.textOverflow = 'ellipsis';
        filenameTd.style.whiteSpace = 'nowrap';

        const sizeTd = document.createElement('td');
        sizeTd.style.width = '100px';
        sizeTd.style.textAlign = 'right';

        // Format size
        const formattedSize = formatSize(fileObj.size || 0);

        // Format truncated filename
        const formattedFilename = truncateFilename(filename, 60);

        // Determine file icon and action
            if (isImage) {
            const fileLink = document.createElement('a');
            fileLink.className = 'filename-link';
            fileLink.textContent = formattedFilename;
            fileLink.href = '#';
            fileLink.title = filename;
            fileLink.onclick = (e) => {
                e.preventDefault();
                showImageModal(url, filename);
                return false;
            };
            filenameTd.appendChild(fileLink);
            } else if (isVideo) {
            const fileLink = document.createElement('a');
            fileLink.className = 'filename-link';
            fileLink.textContent = formattedFilename;
            fileLink.href = '#';
            fileLink.title = filename;
            fileLink.onclick = (e) => {
                e.preventDefault();
                showVideoModal(url, filename, truncatedFilename);
                return false;
            };
            filenameTd.appendChild(fileLink);
            } else {
            // Create a download link for other files
            const fileLink = document.createElement('a');
            fileLink.className = 'filename-link';
            fileLink.textContent = formattedFilename;
            fileLink.href = url;
            fileLink.title = filename;
            fileLink.download = filename;
            filenameTd.appendChild(fileLink);
        }

        // Display size
        sizeTd.textContent = formattedSize;

        // Append cells to row
        tr.appendChild(filenameTd);
        tr.appendChild(sizeTd);

        return tr;
    };

    // Create grid card for image/video tabs
    const createGridCard = () => {
        const col = document.createElement('div');
        col.className = 'col-lg-3 real-item';
        col.setAttribute('data-filename', filename);

        if (isImage) {
            // Check for cached thumbnail
            const cachedThumbnail = localStorage.getItem(`img_thumb_${filename}`);

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

            // If cached thumbnail exists, use it
            if (cachedThumbnail) {
                imgElement.onload = () => {
                    imgElement.classList.add('loaded');
                    if (loadingElement) loadingElement.style.display = 'none';
                };
                imgElement.src = cachedThumbnail;
            } else {
                // Otherwise, load from server and cache
                        imgElement.onload = () => {
                            imgElement.classList.add('loaded');
                            if (loadingElement) loadingElement.style.display = 'none';
                    // Cache thumbnail
                    safelyStoreInLocalStorage(`img_thumb_${filename}`, imgElement.src);
                };
                imgElement.src = `${url}?thumb=1`;
            }
        } else if (isVideo) {
            // Set up video card with cached or generated thumbnail
            const cachedThumbnail = localStorage.getItem(`video_thumb_${filename}`);
            const videoHtml = `
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
            col.innerHTML = videoHtml;

            // Get elements
            const imgElement = col.querySelector('.thumbnail-img');
            const loadingElement = col.querySelector('.thumbnail-loading');

            // Set up click handler
            col.querySelector('.thumbnail-container').onclick = () => showVideoModal(url, filename, truncateFilename(filename, 30));

            // If we have a cached thumbnail, use it
            if (cachedThumbnail) {
                imgElement.onload = () => {
                    imgElement.classList.add('loaded');
                    if (loadingElement) loadingElement.style.display = 'none';
                };
                imgElement.src = cachedThumbnail;
                } else {
                    captureVideoFrame(url, (thumbnail) => {
                        safelyStoreInLocalStorage(`video_thumb_${filename}`, thumbnail);
                        //safelyStoreInLocalStorage(`duration_${filename}`, duration);
                        imgElement.onload = () => {
                            imgElement.classList.add('loaded');
                            if (loadingElement) loadingElement.style.display = 'none';
                        };
                        imgElement.src = thumbnail;
                    });
            }
        } else {
            col.innerHTML = `
                <div class="card h-100">
                    <div class="card-body text-center">
                        <i class="bi bi-file-earmark text-muted mb-2" style="font-size: 2rem;"></i>
                        <div class="small text-muted mb-2 text-truncate" title="${filename}">${filename}</div>
                        <a href="${url}" download class="btn btn-primary btn-sm">
                            <i class="bi bi-download"></i> Download
                        </a>
                    </div>
                </div>`;
        }

        return col;
    };

    // Return appropriate element based on current view
    // Get current filter value from active tab at execution time
    function getCurrentView() {
        const activeFilter = document.querySelector('.filter-tabs .active')?.dataset.filter || 'all';
        console.log(`Current active filter: ${activeFilter}`);
        if (activeFilter === 'all') {
        return createTableRow();
    } else {
        return createGridCard();
    }
    }
    
    return getCurrentView();
}

/**
 * Shows the image modal with the clicked image
 * @param {string} url - URL of the image to display
 * @param {string} filename - Filename of the image
 * @param {string} title - Optional title to display
 */
function showImageModal(url, filename, title = '') {
    // Pause background loading operations
    isModalOpen = true;
    loadingPaused = true;
    
    // Get the modal
    const imageModal = document.getElementById('imageModal');
    if (!imageModal) return;
    
    // Set the modal title
    const modalTitle = imageModal.querySelector('.modal-title');
    if (modalTitle) {
        modalTitle.textContent = title || filename || 'Image Preview';
    }

    // Get the image element and loading indicator
    const modalImage = document.getElementById('modalImage');
    const loadingIndicator = document.getElementById('imageLoadingIndicator');
    
    if (modalImage) {
        // Show loading state
        modalImage.style.opacity = '0.3';
        if (loadingIndicator) loadingIndicator.style.display = 'block';
        
        // Set image source
        modalImage.src = url;
        
        // Handle image load event
        modalImage.onload = function() {
            modalImage.style.opacity = '1';
            if (loadingIndicator) loadingIndicator.style.display = 'none';
        };
        
        // Handle image error
        modalImage.onerror = function() {
            modalImage.style.display = 'none';
            if (loadingIndicator) loadingIndicator.style.display = 'none';
            
            const modalBody = imageModal.querySelector('.modal-body');
            if (modalBody) {
                modalBody.innerHTML = `
                    <div class="alert alert-danger text-center p-5">
                        <i class="bi bi-exclamation-triangle me-2"></i>
                        Error loading image
                    </div>
                `;
            }
        };
    }
    
    // Setup delete button with the filename
    const deleteBtn = document.getElementById('deleteImageBtn');
    if (deleteBtn) {
        // Remove any existing event listeners
        const newDeleteBtn = deleteBtn.cloneNode(true);
        deleteBtn.parentNode.replaceChild(newDeleteBtn, deleteBtn);
        
        // Add new event listener
        newDeleteBtn.addEventListener('click', function() {
            // Close the modal first
            const modalInstance = bootstrap.Modal.getInstance(imageModal);
            if (modalInstance) modalInstance.hide();
            
            // Confirm deletion
            if (confirm(`Are you sure you want to delete "${filename}"?`)) {
                deleteFile(filename);
            }
        });
    }
    
    // Show the modal
    const modal = new bootstrap.Modal(imageModal);
    modal.show();
    
    // Handle modal close event
    imageModal.addEventListener('hidden.bs.modal', function() {
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
    });
}

/**
 * Shows the video modal with ONLY the clicked video
 * Pauses background loading for better performance
 */
function showVideoModal(url, filename, title = '') {
    // Pause background loading operations
    isModalOpen = true;
    loadingPaused = true;
    
    // Get the modal
    const videoModal = document.getElementById('videoModal');
    if (!videoModal) return;
    
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
    video.playsInline = true; // Prevent iOS fullscreen
    video.className = 'w-100 h-auto';
    video.id = 'activeVideoPlayer';
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
        
        // Cache thumbnail to localStorage when video is loaded
        // Use the queuing system instead of direct call
        queueVideoThumbnail(url, filename, null, null);
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
    
    // Update the modal footer with delete button
    const modalFooter = videoModal.querySelector('.modal-footer');
    if (modalFooter) {
        // Clear existing buttons
        modalFooter.innerHTML = '';
        
        // Add delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'btn btn-danger';
        deleteBtn.innerHTML = '<i class="bi bi-trash"></i> Delete';
        
        // Add delete event handler
        deleteBtn.addEventListener('click', function() {
            // Close the modal first
            const modalInstance = bootstrap.Modal.getInstance(videoModal);
            if (modalInstance) modalInstance.hide();
            
            // Confirm deletion
            if (confirm(`Are you sure you want to delete "${filename}"?`)) {
                deleteFile(filename);
            }
        });
        
        // Add close button
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'btn btn-secondary';
        closeBtn.innerHTML = '<i class="bi bi-x-circle"></i> Close';
        closeBtn.setAttribute('data-bs-dismiss', 'modal');
        
        // Add buttons to footer
        modalFooter.appendChild(deleteBtn);
        modalFooter.appendChild(closeBtn);
    }
    
    // Add a proper modal close handler
    const closeHandler = function() {
        // Properly stop the video
        const videoElement = document.getElementById('activeVideoPlayer');
        if (videoElement) {
            // Pause the video
            videoElement.pause();
            // Clear the source to stop any background loading
            videoElement.removeAttribute('src');
            // Force the browser to stop using the video
            videoElement.load();
        }
        
        // Clear container content
        videoContainer.innerHTML = '';
        
        // Reset loading state
        isModalOpen = false;
        loadingPaused = false;
        
        // Process any queued loading operations
        if (loadingQueue && loadingQueue.length > 0) {
            console.log(`Processing ${loadingQueue.length} queued loading operations`);
            while (loadingQueue.length > 0) {
                const operation = loadingQueue.shift();
                operation();
            }
        }
        
        // Remove this event listener to prevent multiple bindings
        videoModal.removeEventListener('hidden.bs.modal', closeHandler);
    };
    
    // Handle modal close with a proper event listener
    videoModal.addEventListener('hidden.bs.modal', closeHandler);
}

// Add this flag to track if initialization has been done
let appInitialized = false;

// Main initialization function
document.addEventListener('DOMContentLoaded', function() {
    // Prevent double initialization
    if (appInitialized) {
        console.log('App already initialized, skipping duplicate initialization');
        return;
    }
    
    console.log('Initializing app for the first time');
    appInitialized = true;
    
    // Show/hide filter tabs based on active tab
    const filterContainer = document.querySelector('.filter-container');
    const viewTab = document.getElementById('view-tab');
    const uploadTab = document.getElementById('upload-tab');
    
    if (filterContainer && viewTab && uploadTab) {
        // Show filter tabs when View Files tab is active, hide otherwise
        viewTab.addEventListener('shown.bs.tab', function() {
            filterContainer.style.display = 'flex';
        });
        
        uploadTab.addEventListener('shown.bs.tab', function() {
            filterContainer.style.display = 'none';
        });
        
        // Set initial state
        if (viewTab.classList.contains('active')) {
            filterContainer.style.display = 'flex';
        } else {
            filterContainer.style.display = 'none';
        }
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
            
            // Load gallery with this filter, always start at page 1 when changing filters
            loadGallery(targetFilter, 1);
        });
    });

    // Clear any existing gallery content
    const gallery = document.getElementById('gallery');
    if (gallery) {
        gallery.innerHTML = '';
    }

    // Use URL parameter first, then saved state
    const urlFilter = getUrlParameter('filter');
    const urlPage = parseInt(getUrlParameter('page')) || 1;
    const savedState = localStorage.getItem('appState');
    let initialFilter = 'all';
    let initialPage = 1;

    if (urlFilter) {
        initialFilter = urlFilter;
        if (urlPage) {
            initialPage = urlPage;
        }
    } else if (savedState) {
        try {
            const state = JSON.parse(savedState);
            initialFilter = state.currentFilter || 'all';
            // Only use saved page for 'all' filter with pagination
            if (initialFilter === 'all' && isPaginationEnabled) {
                initialPage = state.currentPage || 1;
            }
        } catch (e) {
            console.warn('Could not parse saved state', e);
        }
    }

    // Update active state
    updateFilterButtonState(initialFilter);
    
    // Load gallery only once
    console.log(`Initial load with filter: ${initialFilter}, page: ${initialPage}`);
    loadGallery(initialFilter, initialPage);
    
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
});

// Function to handle loading indicator clicks
function handleLoadingIndicatorClick(event) {
    if (event.target.closest('.gallery-loading-indicator') || 
        event.target.closest('.scroll-loading-indicator')) {
        const indicator = event.target.closest('.gallery-loading-indicator') || 
                         event.target.closest('.scroll-loading-indicator');
        indicator.remove();
    }
}

/**
 * Captures a frame from a video URL and returns it as a data URL
 * Uses a more efficient approach with performance optimizations
 * @param {string} url - The URL of the video
 * @param {Function} callback - Callback function that receives the thumbnail
 */
function captureVideoFrame(url, callback) {
    // Use a timeout to prevent hanging on video load
    let timeoutId = setTimeout(() => {
        console.warn(`Video thumbnail generation timed out for ${url}`);
        createFallbackThumbnail();
    }, 10000); // 10 second timeout
    
    // Create a video element for thumbnail capture
    const video = document.createElement('video');
    video.muted = true; // Ensure muted for autoplay
    video.playsInline = true; // Better mobile support
    video.preload = 'metadata'; // Only load metadata first
    video.crossOrigin = 'anonymous'; // Handle CORS if necessary
    
    // Create fallback thumbnail if needed
    function createFallbackThumbnail() {
        clearTimeout(timeoutId);
        // Create a default thumbnail for video errors
        const canvas = document.createElement('canvas');
        canvas.width = 300;
        canvas.height = 200;
        const ctx = canvas.getContext('2d');
        // Fill with gradient background
        const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0, '#f5f5f5');
        gradient.addColorStop(1, '#e0e0e0');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // Add video icon
        ctx.fillStyle = '#999999';
        ctx.font = 'bold 48px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('▶️', canvas.width/2, canvas.height/2);
        // Add error text
        ctx.font = '14px sans-serif';
        ctx.fillText('Video preview unavailable', canvas.width/2, canvas.height/2 + 40);
        
        // Clean up
        if (video) {
            video.removeAttribute('src');
            video.load();
        }
        
        callback(canvas.toDataURL('image/jpeg', 0.6));
    }

    // Set up event handlers
    video.onloadedmetadata = function() {
        // Once metadata is loaded, seek to a good frame
        video.currentTime = Math.min(1, video.duration * 0.1); // Either 1 second or 10% of video
    };

    video.onseeked = function() {
        try {
            clearTimeout(timeoutId);
            
            // Create a smaller canvas for better performance
            const canvas = document.createElement('canvas');
            const maxSize = 300; // Optimal size for thumbnails
            const scale = Math.min(1, maxSize / Math.max(video.videoWidth, video.videoHeight));
            canvas.width = Math.round(video.videoWidth * scale);
            canvas.height = Math.round(video.videoHeight * scale);
            
            // Draw the video frame to canvas
            const context = canvas.getContext('2d');
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            // Check if the frame is black or nearly black
            const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            
            // Sample pixels to check for black frame
            const pixelCount = data.length / 4; // RGBA values
            const sampleSize = Math.min(pixelCount, 1000); // Check up to 1000 pixels
            const sampleStep = Math.max(1, Math.floor(pixelCount / sampleSize));
            
            let blackPixelCount = 0;
            for (let i = 0; i < data.length; i += sampleStep * 4) {
                // Check if pixel is nearly black (very low RGB values)
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                const brightness = (r + g + b) / 3;
                
                if (brightness < 20) { // Consider pixels with average brightness below 20 as "black"
                    blackPixelCount++;
                }
            }
            
            // If more than 90% of sampled pixels are black, consider it a black frame
            const blackPixelPercentage = (blackPixelCount / sampleSize) * 100;
            if (blackPixelPercentage > 90) {
                console.warn(`Detected black frame for ${url}, using fallback thumbnail`);
                createFallbackThumbnail();
                return;
            }
            
            // Get the image data with optimized compression
            const dataURL = canvas.toDataURL('image/jpeg', 0.7);
            
            // Clean up resources
            video.removeAttribute('src');
            video.load();
            
            callback(dataURL);
        } catch (err) {
            console.error('Error capturing video frame:', err);
            createFallbackThumbnail();
        }
    };

    // Handle errors
    video.onerror = function(e) {
        console.error(`Error loading video for thumbnail: ${url}`, e);
        createFallbackThumbnail();
    };

    // Set the source and load
    try {
        video.src = url;
        video.load();
    } catch (err) {
        console.error('Error setting video source:', err);
        createFallbackThumbnail();
    }
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
//setInterval(cleanupPlaceholders, 5000);

/**
 * Processes files sequentially with a delay between each for a smoother appearance
 * Respects loading pauses for better performance during modal viewing
 */
async function processFilesSequentially(files, gallery, page) {
    console.log(`Beginning sequential processing for ${files.length} files`);
    
    // Get last modified dates and ensure they're sorted
    let filesWithDates = [...files]; // Create a copy to avoid modifying original array
    
    // Check if we need to fetch dates (old format) or if they're already there (new format)
    if (Array.isArray(filesWithDates) && filesWithDates.length > 0) {
        try {
            // If dates are missing, fetch them
            const missingDates = !filesWithDates[0].date && !filesWithDates[0].modified;
            if (missingDates) {
                console.log('Dates missing - fetching file dates for sorting...');
                filesWithDates = await Promise.all(filesWithDates.map(async fileObj => {
                    const url = `/uploads/${fileObj.filename}`;
                    try {
                        const response = await fetch(url, { method: 'HEAD' });
                        const lastModified = response.headers.get('last-modified');
                        console.log(`Got date for ${fileObj.filename}: ${lastModified}`);
                        return { 
                            ...fileObj, 
                            date: lastModified ? new Date(lastModified) : new Date(0)
                        };
                    } catch (err) {
                        console.warn(`Failed to get date for ${fileObj.filename}:`, err);
                        return { ...fileObj, date: new Date(0) };
                    }
                }));
            } else {
                console.log('Files already have date information');
            }
            
            // Always sort by date in descending order, regardless of format
            console.log('Sorting files by date (newest first)...');
            filesWithDates.sort((a, b) => {
                // Handle various date formats
                let dateA, dateB;
                
                // Try to parse dates in different formats
                if (a.date instanceof Date) {
                    dateA = a.date;
                } else if (a.date) {
                    dateA = new Date(a.date);
                } else if (a.modified) {
                    dateA = new Date(a.modified);
                } else {
                    dateA = new Date(0); // Default to epoch
                }
                
                if (b.date instanceof Date) {
                    dateB = b.date;
                } else if (b.date) {
                    dateB = new Date(b.date);
                } else if (b.modified) {
                    dateB = new Date(b.modified);
                } else {
                    dateB = new Date(0); // Default to epoch
                }
                
                return dateB - dateA; // Descending order (newest first)
            });
            
            // Log first few sorted files
            console.log("First few files after sorting:");
            filesWithDates.slice(0, 3).forEach((file, index) => {
                const dateObj = file.date instanceof Date ? file.date : new Date(file.date || file.modified || 0);
                console.log(`${index+1}: ${file.filename} - ${dateObj.toISOString()}`);
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
    
    // Process files in batches rather than one by one for better performance
    const batchSize = 5; // Process 5 files at once
    
    for (let i = 0; i < filesWithDates.length; i += batchSize) {
        // Get the current batch of files
        const batch = filesWithDates.slice(i, i + batchSize);
        
        // Process the batch in parallel
        await Promise.all(batch.map(async (fileObj) => {
            const filename = fileObj.filename;
            
            // Skip if this file has already been processed
            if (processedFilenames.has(filename)) {
                return;
            }
            
            // Mark this file as processed
            processedFilenames.add(filename);
            
            // Create the file card
            const fileCard = await createFileCardAsync(fileObj);
            
            // Add the file card to the gallery
            fragment.appendChild(fileCard);
        }));
        
        // No need for artificial delay between batches for better performance
    }
    
    // Remove all remaining placeholders
    const remainingPlaceholders = gallery.querySelectorAll('.placeholder-thumbnail');
    remainingPlaceholders.forEach(placeholder => placeholder.remove());
    
    // Return when all files are processed
    return Promise.resolve();
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
 * Deletes a file from the server
 * @param {string} filename - The filename to delete
 */
function deleteFile(filename) {
    // Show loading toast
    showToast('info', `Deleting ${filename}...`);
    
    // Send delete request to server
    fetch(`/delete/${encodeURIComponent(filename)}`, {
        method: 'DELETE'
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}: ${response.statusText}`);
        }
        return response.json();
    })
    .then(data => {
        console.log('Delete response:', data);
        
        // Show success toast
        showToast('success', `${filename} was deleted successfully`);
        
        // Remove from local storage
        localStorage.removeItem(`img_thumb_${filename}`);
        localStorage.removeItem(`video_thumb_${filename}`);
        
        // Refresh the gallery to show updated content
        loadGallery(currentFilter, currentPage);
    })
    .catch(error => {
        console.error('Error deleting file:', error);
        showToast('error', `Failed to delete ${filename}: ${error.message}`);
    });
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
                captureVideoFrame(url, (thumbnail) => {
                    try {
                        localStorage.setItem(`video_thumb_${filename}`, thumbnail);
                       // localStorage.setItem(`duration_${filename}`, duration);
                    } catch (e) {
                        if (e.name === 'QuotaExceededError') {
                            clearOldThumbnails();
                        }
                    }
                    resolve({ thumbnail });
                });
            });
        } else {
            captureVideoFrame(url, (thumbnail) => {
                try {
                    localStorage.setItem(`video_thumb_${filename}`, thumbnail);
                   // localStorage.setItem(`duration_${filename}`, duration);
                } catch (e) {
                    if (e.name === 'QuotaExceededError') {
                        clearOldThumbnails();
                    }
                }
                resolve({ thumbnail });
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
            const urlPage = parseInt(getUrlParameter('page')) || 1;
            
            currentFilter = urlFilter || state.currentFilter || 'all';
            
            // Determine which page to use
            if (urlFilter && urlPage) {
                // Use URL parameters if both are provided
                currentPage = urlPage;
            } else if (urlFilter) {
                // If only filter is provided in URL, start at page 1
                currentPage = 1;
            } else if (currentFilter === 'all' && isPaginationEnabled && state.currentPage) {
                // Use saved page for 'all' filter with pagination enabled
                currentPage = state.currentPage;
            } else {
                // Default to page 1
                currentPage = 1;
            }
            
            // Update UI to match
            updateFilterButtonState(currentFilter);
            
            // Only load gallery if explicitly requested
            // This prevents double-loading during initialization
            if (loadContent) {
                console.log(`Restoring gallery with filter: ${currentFilter}, page: ${currentPage}`);
                loadGallery(currentFilter, currentPage);
            } else {
                console.log(`Updated filter state to: ${currentFilter}, page: ${currentPage} (without loading content)`);
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
 * Handles scroll events for infinite loading
 */
function handleScroll() {
    // Disable infinite scrolling since we're using pagination for all tabs
    return;
    
    // The code below is kept for reference but is no longer used
    
    // Skip processing if a modal is open or loading is already in progress
    if (isModalOpen || isLoading) return;
    
    // Skip if we're using pagination for the current filter
    if (isPaginationEnabled && currentFilter === 'all') return;

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

// Utility function to safely store an item in localStorage with quota handling
function safelyStoreInLocalStorage(key, value) {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch (e) {
        if (e.name === 'QuotaExceededError') {
            console.warn('localStorage quota exceeded, cleaning up...');
            // Try to clean up storage
            const cleaned = clearOldThumbnails();
            
            // If we did cleaning, try again
            if (cleaned) {
                try {
                    localStorage.setItem(key, value);
                    console.log('Successfully stored item after cleanup');
                    return true;
                } catch (retryError) {
                    console.error('Still cannot store item after cleanup:', retryError);
                }
            }
            
            // If we get here, we couldn't store the item
            return false;
        } else {
            console.error('Error storing in localStorage:', e);
            return false;
        }
    }
}

/**
 * Updates the active state of filter buttons based on the selected filter
 * @param {string} filter - The current filter to set as active
 */
function updateFilterButtonState(filter) {
    const filterButtons = document.querySelectorAll('.btn-filter');
    filterButtons.forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.filter === filter) {
            btn.classList.add('active');
        }
    });
}

// Add at the end of the file
// Setup filter buttons with click handlers
function setupFilterButtons() {
    const filterButtons = document.querySelectorAll('.btn-filter');
    filterButtons.forEach(button => {
        button.addEventListener('click', function() {
            const filter = this.dataset.filter;
            console.log(`Filter button clicked: ${filter}`);
            
            // Update active state
            filterButtons.forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');
            
            // Update current filter
            currentFilter = filter;
            
            // Load gallery with selected filter
            loadGallery(filter, 1);
        });
    });
}

// Call the setup function when the document is ready
document.addEventListener('DOMContentLoaded', function() {
    // Set initial filter from URL or default to 'all'
    const initialFilter = getUrlParameter('filter') || 'all';
    currentFilter = initialFilter;
    
    // Setup filter button click handlers
    setupFilterButtons();
    
    // Load initial gallery
    loadGallery(initialFilter, 1);
    
    // Add other initialization code here
});

/**
 * Processes the video thumbnail queue to limit concurrent loading
 */
function processVideoThumbnailQueue() {
    if (videoThumbnailQueue.length === 0) {
        isProcessingVideoThumbnails = false;
        return;
    }
    
    isProcessingVideoThumbnails = true;
    
    // Count active video processing
    const activeProcessing = videoThumbnailQueue.filter(item => item.isProcessing).length;
    
    // Process up to the maximum concurrent limit
    const availableSlots = MAX_CONCURRENT_VIDEO_THUMBNAILS - activeProcessing;
    if (availableSlots <= 0) return;
    
    // Find the next items to process
    const itemsToProcess = videoThumbnailQueue
        .filter(item => !item.isProcessing && !item.isComplete)
        .slice(0, availableSlots);
    
    // Process these items
    itemsToProcess.forEach(item => {
        item.isProcessing = true;
        
        // Generate the thumbnail
        captureVideoFrame(item.url, (thumbnail) => {
            // Cache the thumbnail
            try {
                safelyStoreInLocalStorage(`video_thumb_${item.filename}`, thumbnail);
                console.log(`Video thumbnail cached for ${item.filename}`);
                
                // Update the image if the element still exists
                if (item.imgElement && document.body.contains(item.imgElement)) {
                    item.imgElement.onload = function() {
                        item.imgElement.classList.add('loaded');
                        if (item.loadingElement && document.body.contains(item.loadingElement)) {
                            item.loadingElement.style.display = 'none';
                        }
                    };
                    item.imgElement.src = thumbnail;
                }
            } catch (e) {
                console.warn('Error storing video thumbnail:', e);
            }
            
            // Mark as complete and remove from queue
            item.isComplete = true;
            item.isProcessing = false;
            
            // Process the next item in queue
            setTimeout(processVideoThumbnailQueue, 100);
        });
    });
}

/**
 * Adds a video to the thumbnail generation queue
 * @param {string} url - URL of the video
 * @param {string} filename - Filename for caching
 * @param {HTMLImageElement} imgElement - Image element to update
 * @param {HTMLElement} loadingElement - Loading element to hide when complete
 */
function queueVideoThumbnail(url, filename, imgElement, loadingElement) {
    // Check if already in queue
    const existingIndex = videoThumbnailQueue.findIndex(item => 
        item.url === url && item.filename === filename);
    
    if (existingIndex >= 0) {
        // Update the references if needed
        if (imgElement) {
            videoThumbnailQueue[existingIndex].imgElement = imgElement;
        }
        if (loadingElement) {
            videoThumbnailQueue[existingIndex].loadingElement = loadingElement;
        }
        return;
    }
    
    // Add to queue
    videoThumbnailQueue.push({
        url,
        filename,
        imgElement,
        loadingElement,
        isProcessing: false,
        isComplete: false,
        addedAt: Date.now()
    });
    
    // Clean up old completed items
    videoThumbnailQueue = videoThumbnailQueue.filter(item => 
        !item.isComplete || Date.now() - item.addedAt < 60000);
    
    // Start processing if not already
    if (!isProcessingVideoThumbnails) {
        processVideoThumbnailQueue();
    }
}

/**
 * Creates placeholder thumbnails for loading state
 * @param {number} count - Number of placeholders to create
 * @returns {DocumentFragment} - Fragment containing placeholders
 */
function createPlaceholderThumbnails(count = 3) {
    const fragment = document.createDocumentFragment();
    const viewMode = document.getElementById('viewModeToggle')?.dataset?.mode || 'grid';
    
    for (let i = 0; i < count; i++) {
        const col = document.createElement('div');
        
        if (viewMode === 'grid') {
            col.className = 'col-lg-3 placeholder-thumbnail';
            const card = document.createElement('div');
            card.className = 'card placeholder-thumbnail h-100 bg-light shadow-sm';
            
            const cardBody = document.createElement('div');
            cardBody.className = 'card-body placeholder-glow';
            
            const imgPlaceholder = document.createElement('div');
            imgPlaceholder.className = 'placeholder-image mb-2';
            imgPlaceholder.style.height = '120px';
            imgPlaceholder.style.backgroundColor = '#e9e9e9';
            imgPlaceholder.style.borderRadius = '3px';
            
            const titlePlaceholder = document.createElement('div');
            titlePlaceholder.className = 'placeholder col-9 mb-2';
            titlePlaceholder.style.height = '18px';
            
            const infoPlaceholder = document.createElement('div');
            infoPlaceholder.className = 'placeholder col-6';
            infoPlaceholder.style.height = '14px';
            
            cardBody.appendChild(imgPlaceholder);
            cardBody.appendChild(titlePlaceholder);
            cardBody.appendChild(infoPlaceholder);
            card.appendChild(cardBody);
            col.appendChild(card);
        } else {
            col.className = 'col-12 mb-2 placeholder-thumbnail';
            const row = document.createElement('div');
            row.className = 'list-item d-flex align-items-center bg-light p-2 rounded placeholder-glow';
            
            const iconPlaceholder = document.createElement('div');
            iconPlaceholder.className = 'placeholder me-2';
            iconPlaceholder.style.width = '40px';
            iconPlaceholder.style.height = '40px';
            iconPlaceholder.style.borderRadius = '3px';
            
            const textContainer = document.createElement('div');
            textContainer.className = 'flex-grow-1';
            
            const titlePlaceholder = document.createElement('div');
            titlePlaceholder.className = 'placeholder col-5 mb-1';
            titlePlaceholder.style.height = '18px';
            
            const infoPlaceholder = document.createElement('div');
            infoPlaceholder.className = 'placeholder col-3';
            infoPlaceholder.style.height = '14px';
            
            textContainer.appendChild(titlePlaceholder);
            textContainer.appendChild(infoPlaceholder);
            
            row.appendChild(iconPlaceholder);
            row.appendChild(textContainer);
            col.appendChild(row);
        }
        
        fragment.appendChild(col);
    }
    
    return fragment;
}
