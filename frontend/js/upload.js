/* upload.js - Ingests Raw Files and Text Contents into RAG knowledge base */

const Upload = {
    activeTab: 'file', // 'file' or 'text'

    init() {
        const uploadModal = document.getElementById('upload-modal');
        const openBtn = document.getElementById('open-upload-btn');
        const closeBtn = document.getElementById('close-upload-modal');
        
        const tabFile = document.getElementById('tab-file-btn');
        const tabText = document.getElementById('tab-text-btn');
        const fileContent = document.getElementById('upload-file-content');
        const textContent = document.getElementById('upload-text-content');

        if (!uploadModal) return;

        // Modal triggers
        openBtn.onclick = () => uploadModal.classList.add('active');
        
        const closeModal = () => {
            uploadModal.classList.remove('active');
            this.resetModalUI();
        };
        closeBtn.onclick = closeModal;

        // Click outside dismiss
        uploadModal.onclick = (e) => {
            if (e.target === uploadModal) closeModal();
        };

        // Tab switcher
        const tabPill = document.getElementById('tab-pill');
        const activeClass = "relative z-10 flex-1 py-2 text-amber focus:outline-none focus:ring-0 cursor-pointer transition-colors duration-300";
        const inactiveClass = "relative z-10 flex-1 py-2 text-gray-500 hover:text-gray-300 focus:outline-none focus:ring-0 cursor-pointer transition-colors duration-300";

        tabFile.onclick = () => {
            this.activeTab = 'file';
            tabFile.className = activeClass;
            tabText.className = inactiveClass;
            if (tabPill) tabPill.style.transform = 'translateX(0px)';
            
            fileContent.classList.remove('hidden');
            textContent.classList.add('hidden');
        };

        tabText.onclick = () => {
            this.activeTab = 'text';
            tabText.className = activeClass;
            tabFile.className = inactiveClass;
            if (tabPill) {
                const distance = tabText.offsetLeft - tabFile.offsetLeft;
                tabPill.style.transform = `translateX(${distance}px)`;
            }
            
            textContent.classList.remove('hidden');
            fileContent.classList.add('hidden');
        };

        // Initialize drag & drop triggers
        this.initDragDrop();

        // Hook Paste Text Submission
        const submitTextBtn = document.getElementById('submit-text-btn');
        if (submitTextBtn) {
            submitTextBtn.onclick = () => this.handleTextSubmit();
        }
    },

    initDragDrop() {
        const dropZone = document.getElementById('drop-zone');
        const fileInput = document.getElementById('file-input');

        if (!dropZone || !fileInput) return;

        // Browse files trigger
        dropZone.onclick = () => fileInput.click();

        fileInput.onchange = (e) => {
            if (e.target.files.length > 0) {
                const filesToUpload = Array.from(e.target.files);
                // Close modal immediately
                document.getElementById('upload-modal').classList.remove('active');
                this.resetModalUI();
                
                // Process each file concurrently
                filesToUpload.forEach(file => this.handleFileUpload(file));
            }
        };

        // Drag Events
        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.add('border-amber/90', 'bg-amber/10');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.remove('border-amber/90', 'bg-amber/10');
            }, false);
        });

        dropZone.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            if (dt.files.length > 0) {
                const filesToUpload = Array.from(dt.files);
                // Close modal immediately
                document.getElementById('upload-modal').classList.remove('active');
                this.resetModalUI();
                
                // Process each file concurrently
                filesToUpload.forEach(file => this.handleFileUpload(file));
            }
        }, false);
    },

    resetModalUI() {
        const dropZone = document.getElementById('drop-zone');
        const submitTextBtn = document.getElementById('submit-text-btn');
        
        if (dropZone) dropZone.classList.remove('hidden');
        
        if (submitTextBtn) {
            submitTextBtn.disabled = false;
            submitTextBtn.textContent = 'Add Document';
        }

        document.getElementById('paste-title-input').value = '';
        document.getElementById('paste-textarea').value = '';
        document.getElementById('file-input').value = '';
    },

    // Handle File Ingestion
    async handleFileUpload(file) {
        // Validate extension
        const ext = '.' + file.name.split('.').pop().toLowerCase();
        const allowed = App.config.allowed_extensions || [".txt", ".docx", ".pdf"];
        if (!allowed.includes(ext)) {
            App.showToast(`Unsupported file type: ${ext}. Supported: ${allowed.join(', ')}`, "error");
            return;
        }

        const maxMB = App.config.max_upload_size_mb || 25;
        if (file.size > maxMB * 1024 * 1024) {
            App.showToast(`File exceeds ${maxMB}MB limit.`, "error");
            return;
        }

        // Show shimmer in sidebar
        if (typeof Sidebar !== 'undefined' && typeof Sidebar.addShimmerCard === 'function') {
            Sidebar.addShimmerCard(file.name);
        }

        // Prepare multi-part form payload
        const formData = new FormData();
        formData.append('file', file);
        formData.append('session_id', App.sessionId);

        const uploadPromise = new Promise((resolve) => {
            try {
                const xhr = new XMLHttpRequest();
                xhr.open('POST', `${App.apiBase}/api/upload`, true);

                const voyageKey = localStorage.getItem('finsight_voyage_key');
                if (voyageKey) xhr.setRequestHeader('X-Voyage-Key', voyageKey);

                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        const response = JSON.parse(xhr.responseText);
                        this.completeIngestionProgress(response);
                    } else {
                        let errMsg = "Upload failed.";
                        try { errMsg = JSON.parse(xhr.responseText).detail || errMsg; } catch(e){}
                        this.failIngestionProgress(errMsg, file.name);
                    }
                    resolve();
                };

                xhr.onerror = () => {
                    this.failIngestionProgress("Network error occurred.", file.name);
                    resolve();
                };

                xhr.send(formData);

            } catch (err) {
                console.error("Ingestion failed:", err);
                this.failIngestionProgress(err.message, file.name);
                resolve();
            }
        });
        
        App.uploadPromises.push(uploadPromise);
        await uploadPromise;
        const index = App.uploadPromises.indexOf(uploadPromise);
        if (index > -1) App.uploadPromises.splice(index, 1);
    },

    // Handle Text Paste Submission
    async handleTextSubmit() {
        const titleInput = document.getElementById('paste-title-input');
        const textarea = document.getElementById('paste-textarea');
        const submitBtn = document.getElementById('submit-text-btn');

        const title = titleInput.value.trim();
        const text = textarea.value.trim();

        if (!title || !text) {
            App.showToast("Both title and text context are required.", "error");
            return;
        }

        // Create virtual txt file
        const blob = new Blob([text], { type: 'text/plain' });
        const file = new File([blob], `${title.replace(/\s+/g, '_')}.txt`, { type: 'text/plain' });

        submitBtn.disabled = true;
        submitBtn.textContent = 'Ingesting Text...';

        // Close modal immediately
        document.getElementById('upload-modal').classList.remove('active');
        this.resetModalUI();

        await this.handleFileUpload(file);
    },

    // Ingestion finished successfully
    completeIngestionProgress(response) {
        // 1. Instantly remove shimmer card
        if (typeof Sidebar !== 'undefined' && typeof Sidebar.removeShimmerCard === 'function') {
            Sidebar.removeShimmerCard(response.filename);
        }

        // 2. Instantly add real document card
        if (typeof Sidebar !== 'undefined' && typeof Sidebar.addDocumentCard === 'function') {
            Sidebar.addDocumentCard(response);
        }

        // 3. Show success toast at the exact same millisecond
        App.showToast(`"${response.filename}" processed successfully and ready for questions.`, 'success');
        
        // 4. Fire and forget a background sync (optional but safe)
        if (typeof Sidebar !== 'undefined') {
            Sidebar.loadDocuments();
        }
    },

    // Ingestion failed
    failIngestionProgress(errorMsg, filename) {
        let cleanMsg = errorMsg || "Ingestion failed.";
        const lower = String(cleanMsg).toLowerCase();
        if (lower.includes('network') || lower.includes('failed to fetch')) {
            cleanMsg = "Unable to reach server. Please check your connection.";
        } else if (lower.includes('500') || lower.includes('status 500') || lower.includes('internal server error')) {
            cleanMsg = "Server busy. Please try uploading again in a few moments.";
        }
        App.showToast(`Upload incomplete for "${filename}": ${cleanMsg}`, 'error');

        if (typeof Sidebar !== 'undefined' && typeof Sidebar.removeShimmerCard === 'function') {
            Sidebar.removeShimmerCard(filename);
        }
    }
};

window.addEventListener('DOMContentLoaded', () => Upload.init());
