document.addEventListener('DOMContentLoaded', async function() {
  const list = document.getElementById('documents-list');
  const emptyMsg = document.getElementById('empty-docs-message');
  const title = document.querySelector('.doc-header h2');

  // Pagination variables
  const FILES_PER_PAGE = 30;
  let files = [];
  let filteredFiles = [];
  let currentPage = 1;
  let totalPages = 1;

  // Helper to format file size
  function formatSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function renderPage(page) {
    list.innerHTML = '';
    const data = filteredFiles.length ? filteredFiles : files;
    if (!data.length) {
      emptyMsg.style.display = '';
      return;
    }
    emptyMsg.style.display = 'none';
    totalPages = Math.ceil(data.length / FILES_PER_PAGE);
    const start = (page - 1) * FILES_PER_PAGE;
    const end = start + FILES_PER_PAGE;
    data.slice(start, end).forEach(file => {
      const li = document.createElement('li');
      const link = document.createElement('a');
      link.className = 'doc-filename';
      link.href = `/uploads/${encodeURIComponent(file.filename)}`;
      link.download = file.filename;
      link.textContent = file.filename;
      link.title = file.filename;
      li.appendChild(link);
      const size = document.createElement('span');
      size.className = 'doc-size';
      size.textContent = formatSize(file.size || 0);
      li.appendChild(size);
      list.appendChild(li);
    });
    renderPagination();
  }

  function renderPagination() {
    let pagination = document.getElementById('docs-pagination');
    if (!pagination) {
      pagination = document.createElement('div');
      pagination.id = 'docs-pagination';
      pagination.className = 'd-flex flex-wrap justify-content-center align-items-center mt-3 gap-2';
      list.parentNode.appendChild(pagination);
    }
    pagination.innerHTML = '';
    if (totalPages <= 1) return;
    const prevBtn = document.createElement('button');
    prevBtn.className = 'btn btn-outline-secondary btn-sm';
    prevBtn.textContent = 'Previous';
    prevBtn.disabled = currentPage === 1;
    prevBtn.onclick = () => { currentPage--; renderPage(currentPage); };
    pagination.appendChild(prevBtn);

    // Page number buttons with ellipsis
    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, currentPage + 2);
    if (startPage > 1) {
      addPageBtn(1);
      if (startPage > 2) {
        addEllipsis();
      }
    }
    for (let i = startPage; i <= endPage; i++) {
      addPageBtn(i);
    }
    if (endPage < totalPages) {
      if (endPage < totalPages - 1) {
        addEllipsis();
      }
      addPageBtn(totalPages);
    }

    function addPageBtn(i) {
      const pageBtn = document.createElement('button');
      pageBtn.className = 'btn btn-sm ' + (i === currentPage ? 'btn-primary' : 'btn-outline-primary');
      pageBtn.textContent = i;
      pageBtn.disabled = i === currentPage;
      pageBtn.onclick = () => { currentPage = i; renderPage(currentPage); };
      pagination.appendChild(pageBtn);
    }
    function addEllipsis() {
      const ellipsis = document.createElement('span');
      ellipsis.textContent = '...';
      ellipsis.className = 'mx-1 text-muted';
      pagination.appendChild(ellipsis);
    }

    const nextBtn = document.createElement('button');
    nextBtn.className = 'btn btn-outline-secondary btn-sm';
    nextBtn.textContent = 'Next';
    nextBtn.disabled = currentPage === totalPages;
    nextBtn.onclick = () => { currentPage++; renderPage(currentPage); };
    pagination.appendChild(nextBtn);
  }

  // Fetch only document files
  try {
    const res = await fetch('/uploads?filter=other&limit=1000');
    if (!res.ok) throw new Error('Failed to fetch documents');
    const data = await res.json();
    files = Array.isArray(data.files) ? data.files : (Array.isArray(data) ? data : []);
    filteredFiles = [];
    if (title) {
      title.textContent = `Documents (${files.length})`;
    }
    currentPage = 1;
    renderPage(currentPage);
  } catch (err) {
    if (title) title.textContent = 'Documents (0)';
    emptyMsg.textContent = 'Error loading documents.';
    emptyMsg.style.display = '';
  }

  // Move to Top button logic
  const backToTopBtn = document.getElementById('backToTopDocsBtn');
  window.addEventListener('scroll', function() {
    if (window.scrollY > 200) {
      backToTopBtn.classList.remove('d-none');
    } else {
      backToTopBtn.classList.add('d-none');
    }
  });
  backToTopBtn.addEventListener('click', function() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Search functionality
  const searchInput = document.getElementById('doc-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      const query = this.value.trim().toLowerCase();
      if (query.length === 0) {
        filteredFiles = [];
      } else {
        filteredFiles = files.filter(file => file.filename.toLowerCase().includes(query));
      }
      currentPage = 1;
      renderPage(currentPage);
    });
  }
}); 