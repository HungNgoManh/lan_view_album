// --- Device ID and Device Name Dialog Logic ---
function getOrCreateDeviceId() {
    let deviceId = localStorage.getItem('device_id');
    const customDeviceName = localStorage.getItem('custom_device_name');
    if (customDeviceName) {
        return `${customDeviceName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`;
    }
    if (!deviceId) {
        const userAgent = navigator.userAgent;
        const screenWidth = window.screen.width;
        const screenHeight = window.screen.height;
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const language = navigator.language;
        const platform = navigator.platform;
        const colorDepth = window.screen.colorDepth;
        const pixelRatio = window.devicePixelRatio || 1;
        const hardwareConcurrency = navigator.hardwareConcurrency || 'unknown';
        const vendor = navigator.vendor || '';
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
        const deviceType = isMobile ? 'mobile' : 'desktop';
        const deviceSignature = `${userAgent}-${screenWidth}x${screenHeight}-${timeZone}-${language}-${platform}-${colorDepth}-${pixelRatio}-${hardwareConcurrency}-${vendor}-${deviceType}`;
        let hash = 0;
        for (let i = 0; i < deviceSignature.length; i++) {
            const char = deviceSignature.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        let prefix = 'd_';
        if (userAgent.includes('Windows')) prefix = 'win';
        else if (userAgent.includes('Macintosh') || userAgent.includes('Mac OS')) prefix = 'mac';
        else if (userAgent.includes('Linux')) prefix = 'linux';
        else if (userAgent.includes('iPhone')) prefix = 'iphone';
        else if (userAgent.includes('iPad')) prefix = 'ipad';
        else if (userAgent.includes('Android')) prefix = 'android';
        deviceId = `${prefix}_${Math.abs(hash).toString(16).substring(0, 8)}`;
        localStorage.setItem('device_id', deviceId);
        setTimeout(() => {
            showDeviceNameDialog(deviceId);
        }, 2000);
    }
    return deviceId;
}

function showDeviceNameDialog(currentDeviceId) {
    if (localStorage.getItem('device_name_prompted')) return;
    localStorage.setItem('device_name_prompted', 'true');
    const modalHtml = `
    <div class="modal fade" id="deviceNameModal" tabindex="-1" aria-labelledby="deviceNameModalLabel" aria-hidden="true">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="deviceNameModalLabel">Name Your Device</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <p>To better organize your uploads, please give this device a name.</p>
            <p>Current device ID: <code>${currentDeviceId}</code></p>
            <div class="mb-3">
              <label for="deviceNameInput" class="form-label">Device Name</label>
              <input type="text" class="form-control" id="deviceNameInput" placeholder="e.g., MyLaptop, Work PC, iPhone">
              <div class="form-text">This helps identify which device uploaded which files.</div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Skip</button>
            <button type="button" class="btn btn-primary" id="saveDeviceName">Save</button>
          </div>
        </div>
      </div>
    </div>
    `;
    const modalContainer = document.createElement('div');
    modalContainer.innerHTML = modalHtml;
    document.body.appendChild(modalContainer);
    const modal = new bootstrap.Modal(document.getElementById('deviceNameModal'));
    modal.show();
    document.getElementById('saveDeviceName').addEventListener('click', () => {
        const deviceName = document.getElementById('deviceNameInput').value.trim();
        if (deviceName) {
            localStorage.setItem('custom_device_name', deviceName);
            const newDeviceId = `device_${deviceName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`;
            localStorage.setItem('device_id', newDeviceId);
            const toastEl = document.getElementById('uploadToast');
            if (toastEl) {
                const toast = bootstrap.Toast.getOrCreateInstance(toastEl);
                document.getElementById('toastMessage').textContent = `✅ Device name set to "${deviceName}"`;
                toast.show();
            }
        }
        modal.hide();
    });
}

// --- Toast Helper ---
function showUploadToast(message, type = 'warning') {
  let toastEl = document.getElementById('uploadToast');
  if (toastEl) {
    document.getElementById('toastMessage').textContent = message;
    const header = toastEl.querySelector('.toast-header');
    header.classList.remove('bg-warning', 'bg-danger', 'bg-success');
    if (type === 'danger') header.classList.add('bg-danger');
    else if (type === 'success') header.classList.add('bg-success');
    else header.classList.add('bg-warning');
    const toast = bootstrap.Toast.getOrCreateInstance(toastEl);
    toast.show();
  } else {
    alert(message);
  }
}

// --- Uppy Setup and Advanced Event Handlers ---
let skippedDuplicateFiles = 0;
let existingFilesCache = null;

document.addEventListener('DOMContentLoaded', function() {
  const dragDropArea = document.getElementById('drag-drop-area');
  if (!dragDropArea) return;

  const uppy = new Uppy.Uppy({ restrictions: { maxNumberOfFiles: 1000 } })
    .use(Uppy.Dashboard, {
      inline: true,
      target: '#drag-drop-area',
      showProgressDetails: true,
      proudlyDisplayPoweredByUppy: false,
      note: 'Images, Videos, Audios, Documents supported',
      height: 'fit-content',
      width: '100%',
      hideUploadButton: false,
      hideProgressAfterFinish: true,
      showLinkToFileUploadResult: false,
      showRemoveButtonAfterComplete: true,
      showSelectedFiles: true,
      showSelectedFilesPanel: true
    })
    .use(Uppy.XHRUpload, {
      endpoint: '/upload',
      fieldName: 'file',
      bundle: false,
      headers: () => ({
        'device-id': getOrCreateDeviceId()
      })
    });

  uppy.on('file-added', async (file) => {
    if (!existingFilesCache) {
      try {
        const response = await fetch('/uploads?checkDuplicates=true');
        const data = await response.json();
        existingFilesCache = data && data.files && Array.isArray(data.files)
          ? new Set(data.files.map(file => file.filename))
          : new Set();
      } catch (error) {
        console.warn('Error fetching file list for duplicate check:', error);
        return;
      }
    }
    const existingFiles = existingFilesCache;
    const deviceId = getOrCreateDeviceId();
    const potentialServerFilename = `${deviceId}_${file.name}`;
    let isDuplicate = false;
    let duplicateFilename = '';
    if (existingFiles.has(potentialServerFilename)) {
      isDuplicate = true;
      duplicateFilename = potentialServerFilename;
    }
    if (isDuplicate) {
      skippedDuplicateFiles++;
      showUploadToast(`⚠️ Skipping file "${file.name}" as it already exists on server as "${duplicateFilename}"`, 'warning');
      uppy.removeFile(file.id);
      return;
    }
  });

  uppy.on('upload-success', (file, response) => {
    if (response.body && response.body.isDuplicate) {
      showUploadToast(`⚠️ File "${file.name}" was uploaded but is a duplicate of an existing file.`, 'warning');
    }
  });

  uppy.on('upload-error', (file, error, response) => {
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
    const icon = isDuplicate ? '⚠️' : '❌';
    showUploadToast(`${icon} ${errorMessage}: ${file.name}`, isDuplicate ? 'warning' : 'danger');
    if (isDuplicate) {
      skippedDuplicateFiles++;
    }
  });

  uppy.on('complete', (result) => {
    const skippedFiles = skippedDuplicateFiles;
    skippedDuplicateFiles = 0;
    existingFilesCache = null;
    let message = '';
    if (result.successful.length > 0) {
      message += `✅ ${result.successful.length} file(s) uploaded successfully! `;
    }
    if (skippedFiles > 0) {
      message += `⚠️ ${skippedFiles} duplicate file(s) were skipped.`;
    }
    if (message) showUploadToast(message, 'success');
    if (result.successful.length > 0) {
      setTimeout(() => {
        window.location.href = 'index.html';
      }, 1200);
    }
  });

  // Mobile height fix
  function fixUppyHeight() {
    if (window.innerWidth < 768) {
      var uppyOuter = document.querySelector('#drag-drop-area > [role="presentation"]');
      if (uppyOuter) {
        uppyOuter.style.height = 'auto';
        uppyOuter.style.minHeight = '0';
        uppyOuter.style.maxHeight = 'none';
      }
    }
  }
  fixUppyHeight();
  window.addEventListener('resize', fixUppyHeight);

  // Add click handler for device settings button
  const deviceSettingsBtn = document.getElementById('device-settings-btn');
  if (deviceSettingsBtn) {
    deviceSettingsBtn.addEventListener('click', function() {
      openDeviceNameSettings();
    });
  }
});

// Add a function to allow users to change their device name later
function openDeviceNameSettings() {
    const currentDeviceId = localStorage.getItem('device_id') || 'unknown';
    const currentCustomName = localStorage.getItem('custom_device_name') || '';
    // Create Bootstrap modal for device naming
    const modalHtml = `
    <div class="modal fade" id="deviceSettingsModal" tabindex="-1" aria-labelledby="deviceSettingsModalLabel" aria-hidden="true">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="deviceSettingsModalLabel">Device Settings</h5>
            <div class="d-flex">
              <button type="button" class="btn btn-danger btn-sm me-2" id="logoutBtnSettings">
                <i class="bi bi-box-arrow-right me-1"></i>Logout
              </button>
              <button type="button" class="btn-close p-2 m-1" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
          </div>
          <div class="modal-body p-3">
            <p class="mt-0">Current device ID: <code>${currentDeviceId}</code></p>
            <div class="mb-1">
              <label for="deviceNameSettingsInput" class="form-label mb-1">Change Device Name</label>
              <input type="text" class="form-control mb-1" id="deviceNameSettingsInput" value="${currentCustomName}" placeholder="e.g., MyLaptop, Work PC, iPhone">
              <div class="form-text small">This helps identify which device uploaded which files.</div>
            </div>
          </div>
          <div class="modal-footer d-flex justify-content-between">  <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" id="saveDeviceSettings">Save</button>
          </div>
        </div>
      </div>
    </div>
    `;
    // Add the modal to the document
    const modalContainer = document.createElement('div');
    modalContainer.innerHTML = modalHtml;
    document.body.appendChild(modalContainer);
    // Initialize the modal
    const modal = new bootstrap.Modal(document.getElementById('deviceSettingsModal'));
    modal.show();
    // Handle save button click
    document.getElementById('saveDeviceSettings').addEventListener('click', () => {
        const deviceName = document.getElementById('deviceNameSettingsInput').value.trim();
        if (deviceName) {
            localStorage.setItem('custom_device_name', deviceName);
            const newDeviceId = `device_${deviceName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`;
            localStorage.setItem('device_id', newDeviceId);
            console.log(`Updated device ID to: ${newDeviceId}`);
            // Show toast notification
            const toastEl = document.getElementById('uploadToast');
            if (toastEl) {
                const toast = new bootstrap.Toast(toastEl);
                document.getElementById('toastMessage').textContent = `✅ Device name updated to "${deviceName}"`;
                toast.show();
            }
        }
        modal.hide();
        // Remove modal from DOM only after it's fully hidden
        document.getElementById('deviceSettingsModal').addEventListener('hidden.bs.modal', () => {
            if (modalContainer.parentNode) {
                document.body.removeChild(modalContainer);
            }
        }, { once: true });
    });
    // Handle logout button click
    document.getElementById('logoutBtnSettings').addEventListener('click', () => {
        modal.hide();
        // Call the logout function
        logout();
    });
} 