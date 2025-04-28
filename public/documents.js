document.addEventListener('DOMContentLoaded', async function() {
  const list = document.getElementById('documents-list');
  const emptyMsg = document.getElementById('empty-docs-message');
  const title = document.querySelector('.doc-header h2');

  // Helper to format file size
  function formatSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Fetch only document files
  try {
    const res = await fetch('/uploads?filter=other&limit=1000');
    if (!res.ok) throw new Error('Failed to fetch documents');
    const data = await res.json();
    const files = Array.isArray(data.files) ? data.files : (Array.isArray(data) ? data : []);

    // Update the title with count
    if (title) {
      title.textContent = `Documents (${files.length})`;
    }

    if (!files.length) {
      emptyMsg.style.display = '';
      return;
    }

    files.forEach(file => {
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
  } catch (err) {
    if (title) title.textContent = 'Documents (0)';
    emptyMsg.textContent = 'Error loading documents.';
    emptyMsg.style.display = '';
  }
}); 