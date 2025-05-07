function createImageThumbnail(url) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous'; // Handle CORS if necessary
        img.onload = function() {
            const canvas = document.createElement('canvas');
            // Increase thumbnail size for better quality
            const maxSize = 250; // decreased from 300
            const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
            canvas.width = img.width * scale;
            canvas.height = img.height * scale;
            const context = canvas.getContext('2d');
            context.drawImage(img, 0, 0, canvas.width, canvas.height);
            // Higher quality JPEG compression
            const dataURL = canvas.toDataURL('image/jpeg', 0.6); // decreased from 0.7
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
let currentFilter = 'image'; // Default to Photos tab
let currentPage = 1;
let hasMore = true;
let isLoading = false;
let isModalOpen = false;
let scrollTimeout = null;
let isPaginationEnabled = true; // Controls whether to use pagination or infinite scroll
let filesPerPage = 50; // Default for desktop (10 columns × 5 rows)
let totalFiles = 0;
let totalPages = 0;

// Add this global variable to track scroll direction
let lastScrollTop = 0;
let loadingPaused = false;
let loadingQueue = [];

// Add these variables at the top of your script file
let videoThumbnailQueue = [];
let isProcessingVideoThumbnails = false;
const MAX_CONCURRENT_VIDEO_THUMBNAILS = 1; // Limit concurrent video processing

// Adjust files per page based on screen size
function updateFilesPerPage() {
    if (window.innerWidth < 768) {
        // Mobile: 4 columns × 8 rows = 32 items
        filesPerPage = 32;
    } else {
        // Tablet/Desktop: 10 columns × 5 rows = 50 items
        filesPerPage = 50;
    }
    console.log(`Screen width: ${window.innerWidth}px, Files per page: ${filesPerPage}`);
}

// Set initial value
updateFilesPerPage();

// Update on resize
window.addEventListener('resize', updateFilesPerPage);


// Update the loadGallery function to handle sequential loading
async function loadGallery(filter = 'image', page = 1, maintainScroll = false) {
    // Prevent duplicate loading requests
    if (isLoading) {
        console.log(`Skipping duplicate loading request (filter: ${filter}, page: ${page})`);
        return;
    }
    // If filter is 'all', redirect to 'image' (Photos tab)
    if (filter === 'all') {
        filter = 'image';
    }
    isLoading = true;

    // Store scroll position as a percentage if we need to maintain scroll
    let scrollPercentage = 0;
    if (maintainScroll) {
        const scrollPosition = window.scrollY;
        const documentHeight = Math.max(
            document.body.scrollHeight, 
            document.body.offsetHeight,
            document.documentElement.clientHeight,
            document.documentElement.scrollHeight,
            document.documentElement.offsetHeight
        );
        scrollPercentage = scrollPosition / documentHeight;
        console.log(`Storing scroll percentage: ${(scrollPercentage * 100).toFixed(2)}%`);
    }

    // Update current filter
    currentFilter = filter;
    currentPage = page;

    // Only scroll to top if this is a filter change or explicitly requested
    // Don't scroll if maintainScroll is true (for pagination clicks)
    if (!maintainScroll) {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    }

    console.log(`Loading gallery with filter: ${filter}, page: ${page}, maintainScroll: ${maintainScroll}`);

    // Get the gallery element
    const gallery = document.getElementById('gallery');
    
    // Show page loading indicator if not first page (for pagination mode)
    if (page >= 1) {
        // Clear existing content when changing pages with pagination
        gallery.innerHTML = '';
        
        // Add loading indicator
        const loadingIndicator = document.createElement('div');
        loadingIndicator.id = 'pageLoadingIndicator';
        loadingIndicator.className = 'col-12 d-flex justify-content-center align-items-center py-5';
        loadingIndicator.innerHTML = `
            <div class="d-flex flex-column align-items-center justify-content-center mx-auto w-100" style="min-height: 120px; text-align: center;">
                <div class="spinner-border text-primary mb-3" role="status" style="width:3rem;height:3rem;min-width:3rem;min-height:3rem;max-width:3rem;max-height:3rem;"></div>
                <span class="fw-semibold text-primary">Loading page ${page}...</span>
            </div>
        `;
        gallery.appendChild(loadingIndicator);
    } 
    // Clear existing content if this is first page
    else if (gallery && page === 1) {
        // Clear existing content completely before adding new content
        gallery.innerHTML = '';        
    }

    // Disable filter buttons while loading
    const filterButtons = document.querySelectorAll('.btn-filter');
    filterButtons.forEach(btn => btn.disabled = true);

    // Update URL without reloading the page
    const newUrl = new URL(window.location);
    newUrl.searchParams.set('filter', filter);
    newUrl.searchParams.set('page', page);
    window.history.replaceState({}, '', newUrl);

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
        await processGalleryData(standardizedData, gallery, page, filter, maintainScroll);
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
            
        // Update the view layout based on the filter
        updateViewLayout(filter);
        
        // Render pagination for all tabs
        // Clear existing pagination first to prevent stale DOM references
        const paginationContainer = document.getElementById('paginationContainer');
        const paginationWrapper = paginationContainer?.closest('.d-flex');
        
        if (paginationContainer) {
            paginationContainer.innerHTML = '';
            
            // Make sure the container is visible
            if (paginationWrapper) {
                paginationWrapper.classList.remove('d-none');
            }
            
            // Now render the pagination
            renderPagination(totalPages, currentPage, filter);
        }
        
        // Restore scroll position based on the saved percentage if needed
        if (maintainScroll && scrollPercentage > 0) {
            // Wait for DOM to be updated
            setTimeout(() => {
                // Calculate new document height
                const newDocumentHeight = Math.max(
                    document.body.scrollHeight, 
                    document.body.offsetHeight,
                    document.documentElement.clientHeight,
                    document.documentElement.scrollHeight,
                    document.documentElement.offsetHeight
                );
                
                // Apply the same percentage to the new height
                const newScrollPosition = Math.round(newDocumentHeight * scrollPercentage);
                
                // Scroll to the new position
                window.scrollTo({
                    top: newScrollPosition,
                    behavior: 'auto' // Use 'auto' to prevent visible scrolling
                });
                
                console.log(`Restored to same relative position: ${(scrollPercentage * 100).toFixed(2)}%, scroll position: ${newScrollPosition}px`);
            }, 100);
        }
    }
}

// Update processGalleryData to handle one-by-one loading
async function processGalleryData(data, gallery, page, filter, maintainScroll = false) {
    console.log(`Processing gallery data: ${data.files?.length || 0} files, page ${page}, filter ${filter}, total files: ${data.totalFiles}, total pages: ${data.totalPages}, maintainScroll: ${maintainScroll}`);
    
    // No need to store the scroll position since we're keeping the page still
    
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
    
    // Get the target container based on current filter
    let targetContainer = gallery;
    if (filter === 'all') {
        // For 'all' filter, use the list container
        const listBody = document.getElementById('all-files-body');
        if (listBody) {
            targetContainer = listBody;
        }
    } else if (filter === 'other') {
        // For 'other' filter, use the other-files-body list container
        const listBody = document.getElementById('other-files-body');
        if (listBody) {
            targetContainer = listBody;
        }
    }
    
    // Check for existing files in the gallery (to prevent duplicates on refresh)
    if (page === 1) {
        // If this is page 1, we want to clear any existing items to prevent duplicates
        if (filter === 'all') {
            targetContainer.innerHTML = '';
        } else if (filter === 'other') {
            targetContainer.innerHTML = '';
        } else {
            const existingItems = gallery.querySelectorAll('.real-item');
            existingItems.forEach(item => {
                item.remove();
            });
        }
    } else {
        // For subsequent pages, track what's already in the gallery
        const existingItems = targetContainer.querySelectorAll('[data-filename]');
        existingItems.forEach(item => {
            const filename = item.getAttribute('data-filename');
            if (filename) {
                processedFilenames.add(filename);
            }
        });
    }
    
    // Process files in batches rather than one by one for better performance
    // Increase batch size for images/photos tab
    const batchSize = (filter === 'image') ? 20 : 5; // 20 for images, 5 for others
    
    for (let i = 0; i < data.files.length; i += batchSize) {
        // Get the current batch of files
        const batch = data.files.slice(i, i + batchSize);
        
        // Use a DocumentFragment to batch DOM updates
        const fragment = document.createDocumentFragment();

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
            
            // Add the file card to the fragment (not directly to DOM)
            fragment.appendChild(fileCard);
        }));
        
        // Append the fragment to the target container in one operation
        targetContainer.appendChild(fragment);
    }
    
    // Remove all remaining placeholders
    const remainingPlaceholders = gallery.querySelectorAll('.placeholder-thumbnail');
    remainingPlaceholders.forEach(placeholder => placeholder.remove());
    
    // No scroll restoration - leave the page exactly where it is
    
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
    
    const prevLink = document.createElement('a');
    prevLink.className = 'page-link';
    prevLink.href = '#';
    prevLink.setAttribute('aria-label', 'Previous');
    prevLink.innerHTML = '<span aria-hidden="true">&laquo;</span>';
    
    // Add event listener directly instead of using onclick attribute
    if (currentPage !== 1) {
        prevLink.addEventListener('click', function(e) {
            e.preventDefault();
            // Store current scroll position before loading new page
            const scrollY = window.scrollY;
            loadGallery(filter, currentPage - 1, true);
        });
    }
    
    prevLi.appendChild(prevLink);
    paginationContainer.appendChild(prevLi);
    
    // Determine which page numbers to show
    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, startPage + 5);
    
    // On mobile, show fewer page numbers
    const isMobile = window.innerWidth < 576;
    if (isMobile) {
        startPage = Math.max(1, currentPage - 2);
        endPage = Math.min(totalPages, startPage + 3);
    }
    
    // Adjust if we're near the end
    if (endPage - startPage < (isMobile ? 1 : 3)) {
        startPage = Math.max(1, endPage - (isMobile ? 1 : 4));
    }
    
    // Add first page if needed
    if (startPage > 1) {
        const firstLi = document.createElement('li');
        firstLi.className = 'page-item';
        
        const firstLink = document.createElement('a');
        firstLink.className = 'page-link';
        firstLink.href = '#';
        firstLink.textContent = '1';
        firstLink.addEventListener('click', function(e) {
            e.preventDefault();
            loadGallery(filter, 1, true);
        });
        
        firstLi.appendChild(firstLink);
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
        
        const pageLink = document.createElement('a');
        pageLink.className = 'page-link';
        pageLink.href = '#';
        pageLink.textContent = i;
        
        if (i !== currentPage) {
            pageLink.addEventListener('click', function(e) {
                e.preventDefault();
                loadGallery(filter, i, true);
            });
        }
        
        pageLi.appendChild(pageLink);
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
        
        const lastLink = document.createElement('a');
        lastLink.className = 'page-link';
        lastLink.href = '#';
        lastLink.textContent = totalPages;
        lastLink.addEventListener('click', function(e) {
            e.preventDefault();
            loadGallery(filter, totalPages, true);
        });
        
        lastLi.appendChild(lastLink);
        paginationContainer.appendChild(lastLi);
    }
    
    // Add "Next" button
    const nextLi = document.createElement('li');
    nextLi.className = `page-item ${currentPage === totalPages ? 'disabled' : ''}`;
    
    const nextLink = document.createElement('a');
    nextLink.className = 'page-link';
    nextLink.href = '#';
    nextLink.setAttribute('aria-label', 'Next');
    nextLink.innerHTML = '<span aria-hidden="true">&raquo;</span>';
    
    if (currentPage !== totalPages) {
        nextLink.addEventListener('click', function(e) {
            e.preventDefault();
            loadGallery(filter, currentPage + 1, true);
        });
    }
    
    nextLi.appendChild(nextLink);
    paginationContainer.appendChild(nextLi);
    
    // Update pagination info text in the designated element
    const paginationInfo = document.getElementById('paginationInfo');
    if (paginationInfo) {
        const infoText = `Showing ${startItem}-${endItem} of ${totalFiles} files`;
        paginationInfo.textContent = infoText;
        paginationInfo.style.display = 'block'; // Ensure it's visible
        console.log('Updated pagination info:', infoText);
    } else {
        console.warn('Pagination info element not found in DOM');
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
        videos: 0
    };
    
    // Merge with defaults to ensure all properties exist
    const mergedCounts = {...defaultCounts, ...counts};
    
    // If all individual counts are 0 but 'all' is not, calculate it
    if (mergedCounts.images === 0 && mergedCounts.videos === 0 && mergedCounts.all > 0) {
        // This might happen if the server only provided the 'all' count
        console.warn('Individual counts are 0 but total is not, counts might be incomplete');
    } else if (mergedCounts.all === 0) {
        // If 'all' is 0, calculate it from the sum of individuals
        mergedCounts.all = mergedCounts.images + mergedCounts.videos;
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
async function createFileCardAsync(fileObj, forceList = false) {
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

    // Create list item for All tab (replaces table row)
    const createTableRow = () => {
        const li = document.createElement('li');
        li.setAttribute('data-filename', filename);
        li.className = 'no-marker'; // Add class for marker removal
        
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        
        const fileName = document.createElement('div');
        fileName.className = 'file-name';
        
        const fileSize = document.createElement('div');
        fileSize.className = 'file-size';
        
        // Format size
        const formattedSize = formatSize(fileObj.size || 0);
        fileSize.textContent = formattedSize;

        // Get device width to determine truncation length
        const isMobile = window.innerWidth < 768;
        // Use shorter names on mobile
        const maxLength = isMobile ? 25 : 60;
        
        // For mobile, show meaningful parts of the filename
        let displayFilename = filename;
        if (isMobile && filename.length > maxLength) {
            // For longer filenames, keep part of beginning and end
            const ext = filename.split('.').pop();
            const nameWithoutExt = filename.substring(0, filename.length - ext.length - 1);
            
            const firstPart = nameWithoutExt.substring(0, Math.floor(maxLength * 0.6));
            const lastPart = nameWithoutExt.substring(nameWithoutExt.length - Math.floor(maxLength * 0.2));
            
            displayFilename = `${firstPart}...${lastPart}.${ext}`;
        } else {
            displayFilename = truncateFilename(filename, maxLength);
        }

        // Determine file icon and action
        let fileIcon = '';
        if (isImage) {
            fileIcon = '<i class="bi bi-image me-2 text-info"></i>';
        } else if (isVideo) {
            fileIcon = '<i class="bi bi-film me-2 text-primary"></i>';
        } else {
            fileIcon = '<i class="bi bi-file-earmark me-2 text-secondary"></i>';
        }
        
        // Create the file link
        const fileLink = document.createElement('a');
        fileLink.className = 'filename-link';
        fileLink.innerHTML = `${fileIcon}<span class="filename-text">${displayFilename}</span>`;
        fileLink.href = '#';
        fileLink.title = filename; // Full filename as tooltip
        
        // Set the appropriate action based on file type
        if (isImage) {
            fileLink.onclick = (e) => {
                e.preventDefault();
                showImageModal(url, filename);
                return false;
            };
        } else if (isVideo) {
            fileLink.onclick = (e) => {
                e.preventDefault();
                showVideoModal(url, filename, displayFilename);
                return false;
            };
        } else {
            fileLink.href = url;
            fileLink.download = filename;
        }
        
        fileName.appendChild(fileLink);

        // Assemble the item
        fileItem.appendChild(fileName);
        fileItem.appendChild(fileSize);
        li.appendChild(fileItem);

        return li;
    };

    // Create grid card for image/video tabs
    const createGridCard = () => {
        const col = document.createElement('div');
        col.className = 'gallery-col gallery-item';
        col.style.marginBottom = '3px';
        col.setAttribute('data-filename', filename);

        if (isImage) {
            // Check for cached thumbnail
            const cachedThumbnail = localStorage.getItem(`img_thumb_${filename}`);

            // Create a proper thumbnail container with loading spinner
            const thumbnailHtml = `
                <div class="card h-100" style="margin-bottom: 0;">
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

            // Set lazy loading for better performance
            imgElement.loading = 'lazy';

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
            // Use server-side generated thumbnail from /thumbnails
            const videoThumbUrl = `/thumbnails/${filename}.jpg`;
            const videoHtml = `
                <div class="card h-100" style="margin-bottom: 0;">
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

            const imgElement = col.querySelector('.thumbnail-img');
            const loadingElement = col.querySelector('.thumbnail-loading');
            col.querySelector('.thumbnail-container').onclick = () => showVideoModal(url, filename, truncateFilename(filename, 30));
            imgElement.onload = () => {
                imgElement.classList.add('loaded');
                if (loadingElement) loadingElement.style.display = 'none';
            };
            imgElement.onerror = () => {
                // fallback: show a default icon or fallback image
                imgElement.src = '/static/default-video-thumb.jpg';
                if (loadingElement) loadingElement.style.display = 'none';
            };
            imgElement.src = videoThumbUrl;
        } else {
            col.innerHTML = `
                <div class="card h-100" style="margin-bottom: 0;">
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
        if (forceList || activeFilter === 'all' || activeFilter === 'other') {
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

    // Before showing modal, check if thumbnail exists and generate if missing
    const thumbUrl = `/thumbnails/${filename}.jpg`;
    fetch(thumbUrl, { method: 'HEAD' })
        .then(response => {
            if (!response.ok) {
                // Thumbnail does not exist, request generation
                fetch('/api/generate-thumbnail', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename })
                })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        // Optionally update the thumbnail in the UI if present
                        const thumbImg = document.querySelector(`.gallery-item[data-filename='${filename}'] .thumbnail-img`);
                        if (thumbImg) {
                            thumbImg.src = data.thumbnail + '?t=' + Date.now(); // bust cache
                        }
                    }
                });
            }
        });

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
        
        // Add download button
        const downloadBtn = document.createElement('button');
        downloadBtn.type = 'button';
        downloadBtn.className = 'btn btn-primary me-2';
        downloadBtn.innerHTML = '<i class="bi bi-cloud-download-fill"></i> Download';
        
        // Add download event handler
        downloadBtn.addEventListener('click', function() {
            // Create a temporary anchor element
            const downloadLink = document.createElement('a');
            downloadLink.href = url;
            downloadLink.download = filename;
            
            // Programmatically trigger the download
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);
        });
        
        // Add delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'btn btn-danger';
        deleteBtn.innerHTML = '<i class="bi bi-trash-fill"></i> Delete';
        
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
        modalFooter.appendChild(downloadBtn);
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
        
        // Check if thumbnail exists and if it's a fallback thumbnail
        const cachedThumbnail = localStorage.getItem(`video_thumb_${filename}`);
        if (cachedThumbnail && cachedThumbnail.length < 5000) {
            // If thumbnail is too small, it's likely a fallback/placeholder
            // Delete it and regenerate to get a proper thumbnail after viewing
            console.log(`Detected fallback thumbnail for ${filename}, regenerating after view`);
            localStorage.removeItem(`video_thumb_${filename}`);
        }
        
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
            
            // Update current filter
            currentFilter = targetFilter;
            
            // Update the view layout
            updateViewLayout(targetFilter);
            
            // Load gallery with selected filter
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
    let initialFilter = urlFilter || 'image';
    if (initialFilter === 'all' || initialFilter === 'other') {
        initialFilter = 'image'; // Default to Photos
    }
    currentFilter = initialFilter;
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
    
    // No scroll restoration - leave the page exactly where it is
    
    // Return when all files are processed
    return Promise.resolve();
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
            
            let filter = urlFilter || state.currentFilter || 'image';
            if (filter === 'all' || filter === 'other') {
                filter = 'image';
            }
            currentFilter = filter;
            
            // Determine which page to use
            if (urlFilter && urlPage) {
                // Use URL parameters if both are provided
                currentPage = urlPage;
            } else if (urlFilter) {
                // If only filter is provided in URL, start at page 1
                currentPage = 1;
            } else {
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
            
            // Update the view layout
            updateViewLayout(filter);
            
            // Load gallery with selected filter - explicitly set maintainScroll to false
            // This ensures we scroll to top when changing filters
            loadGallery(filter, 1, false);
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
    
    // Update the view layout based on initial filter
    updateViewLayout(initialFilter);
    
    // Load initial gallery
    loadGallery(initialFilter, 1);
    
    // Add other initialization code here
});

/**
 * Preloads video metadata for videos visible in the viewport
 * This helps thumbnail generation be more successful
 */
function preloadVisibleVideoMetadata() {
    // Only run if not already loading or paused
    if (isLoading || loadingPaused) return;

    // Find all video thumbnails in the viewport
    const gallery = document.getElementById('gallery');
    if (!gallery) return;
    
    const videoCards = gallery.querySelectorAll('.thumbnail-container');
    
    // Process each video thumbnail in the viewport
    videoCards.forEach(card => {
        // Skip if already processed
        if (card.dataset.metadataPreloaded === 'true') return;
        
        // Check if in viewport
        const rect = card.getBoundingClientRect();
        const isInViewport = (
            rect.top >= -100 &&
            rect.left >= -100 &&
            rect.bottom <= (window.innerHeight + 100) &&
            rect.right <= (window.innerWidth + 100)
        );
        
        if (isInViewport) {
            // Find the URL from the onclick handler
            const onclickStr = card.getAttribute('onclick') || '';
            const urlMatch = onclickStr.match(/showVideoModal\(['"]([^'"]+)['"]/);
            
            if (urlMatch && urlMatch[1]) {
                const videoUrl = urlMatch[1];
                // Mark as processed
                card.dataset.metadataPreloaded = 'true';
                
                // Create a hidden video element to preload metadata
                const preloader = document.createElement('video');
                preloader.style.display = 'none';
                preloader.preload = 'metadata';
                preloader.muted = true;
                preloader.playsInline = true;
                preloader.playbackRate = 0; // Don't waste CPU on playback
                preloader.crossOrigin = 'anonymous';
                
                // Set up cleanup
                preloader.onloadedmetadata = () => {
                    console.log(`Preloaded metadata for ${videoUrl}`);
                    // Remove after a short delay
                    setTimeout(() => {
                        preloader.remove();
                    }, 1000);
                };
                
                // Clean up in case of errors
                preloader.onerror = () => {
                    console.warn(`Failed to preload metadata for ${videoUrl}`);
                    preloader.remove();
                };
                
                // Add to DOM briefly
                preloader.src = videoUrl;
                document.body.appendChild(preloader);
                
                // Safety cleanup after 3 seconds
                setTimeout(() => {
                    if (document.body.contains(preloader)) {
                        preloader.remove();
                    }
                }, 3000);
            }
        }
    });
}

// Since we're using pagination now, we don't need to preload on scroll
// Only preload on initial page load
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(preloadVisibleVideoMetadata, 1000);
});

/**
 * Updates the view layout based on the current filter
 * @param {string} filter - The current filter (all, image, video)
 */
function updateViewLayout(filter) {
    const allFilesHeader = document.getElementById('all-files-header');
    const gridView = document.getElementById('grid-view');
    const otherFilesHeader = document.getElementById('other-files-header');
    
    if (allFilesHeader && gridView && otherFilesHeader) {
        if (filter === 'all') {
            // For 'all' filter, show the list view (all-files-header)
            allFilesHeader.classList.remove('d-none');
            gridView.classList.add('d-none');
            otherFilesHeader.classList.add('d-none');
        } else if (filter === 'image') {
            // For image filter, show the grid view
            allFilesHeader.classList.add('d-none');
            gridView.classList.remove('d-none');
            otherFilesHeader.classList.add('d-none');
        } else if (filter === 'video') {
            // For video filter, show the grid view
            allFilesHeader.classList.add('d-none');
            gridView.classList.remove('d-none');
            otherFilesHeader.classList.add('d-none');
        } else if (filter === 'other') {
            // For 'other' filter, show the grid view
            allFilesHeader.classList.add('d-none');
            gridView.classList.add('d-none');
            otherFilesHeader.classList.remove('d-none');
        }
    }
}

// Ensure correct gallery view on browser back/forward navigation
window.addEventListener('pageshow', function(event) {
  // Always force grid view for image/video filters
  const urlFilter = getUrlParameter('filter');
  let filter = urlFilter || 'image';
  if (filter === 'all' || filter === 'other') {
    filter = 'image';
  }
  currentFilter = filter;
  updateFilterButtonState(filter);
  updateViewLayout(filter);
  loadGallery(filter, 1);
});