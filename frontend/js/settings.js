/* settings.js - Syncs User Retrieval Parameters (Top-K and Alpha), API Keys, and Diagnostics Dashboard */

const Dashboard = {
    init() {
        const modal = document.getElementById('dashboard-modal');
        const openSettingsBtn = document.getElementById('open-settings-btn');
        const closeBtn = document.getElementById('close-dashboard-modal');

        if (!modal || !openSettingsBtn) return;

        // Settings Elements
        const topKSlider = document.getElementById('top-k-slider');
        const topKReadout = document.getElementById('top-k-readout');
        const alphaSlider = document.getElementById('alpha-slider');
        const alphaReadout = document.getElementById('alpha-readout');

        // API Keys Elements
        const voyageKeyInput = document.getElementById('input-voyage-key');
        const llmKeyInput = document.getElementById('input-llm-key');

        // Status Indicators
        const keysSavedIndicator = document.getElementById('keys-saved-indicator');
        const paramsSavedIndicator = document.getElementById('params-saved-indicator');

        // Modal triggers
        openSettingsBtn.onclick = () => {
            // Populate settings
            topKSlider.value = App.settings.topK;
            topKReadout.textContent = App.settings.topK;
            alphaSlider.value = App.settings.alpha;
            alphaReadout.textContent = App.settings.alpha;

            // Populate API Keys
            voyageKeyInput.value = localStorage.getItem('finsight_voyage_key') || '';
            llmKeyInput.value = localStorage.getItem('finsight_llm_key') || '';

            modal.classList.remove('hidden');
            // Trigger animation frame for CSS transition
            requestAnimationFrame(() => modal.classList.add('active'));
        };

        const closeModal = () => {
            modal.classList.remove('active');
            setTimeout(() => modal.classList.add('hidden'), 300);
        };
        if (closeBtn) closeBtn.onclick = closeModal;

        modal.onclick = (e) => {
            if (e.target === modal) closeModal();
        };

        // Helper to flash save status
        const flashSavedIndicator = (indicator) => {
            if (!indicator) return;
            indicator.classList.add('active');
            setTimeout(() => {
                indicator.classList.remove('active');
            }, 1500);
        };

        // Top-K Slider Real-Time Sync & Auto-save on release
        topKSlider.oninput = (e) => {
            const val = parseInt(e.target.value);
            topKReadout.textContent = val;
            App.settings.topK = val;
            localStorage.setItem('finsight_topk', val);
        };
        topKSlider.onchange = () => {
            flashSavedIndicator(paramsSavedIndicator);
        };

        // Hybrid Alpha Slider Real-Time Sync & Auto-save on release
        alphaSlider.oninput = (e) => {
            const val = parseFloat(e.target.value);
            alphaReadout.textContent = val.toFixed(2);
            App.settings.alpha = val;
            localStorage.setItem('finsight_alpha', val);
        };
        alphaSlider.onchange = () => {
            flashSavedIndicator(paramsSavedIndicator);
        };

        // Auto-save API Keys on input (debounced) or change (blur)
        let saveTimeout;
        const autoSaveKeys = () => {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => {
                localStorage.setItem('finsight_voyage_key', voyageKeyInput.value.trim());
                localStorage.setItem('finsight_llm_key', llmKeyInput.value.trim());
                flashSavedIndicator(keysSavedIndicator);
            }, 500);
        };

        voyageKeyInput.oninput = autoSaveKeys;
        llmKeyInput.oninput = autoSaveKeys;
    },

    renderDiagnosticDocs(container) {
        container.innerHTML = '';
        if (Sidebar.sourcesList.length === 0) {
            container.innerHTML = '<div class="text-center text-taupe/60 italic py-8 text-sm bg-white/[0.02] rounded-xl border border-white/5 border-dashed">No documents uploaded in this session.</div>';
            return;
        }

        Sidebar.sourcesList.forEach((doc, index) => {
            const docEl = document.createElement('div');
            docEl.className = 'doc-card-premium bg-gradient-to-br from-white/[0.05] to-white/[0.02] rounded-xl border border-white/10 overflow-hidden transition-all duration-300 hover:border-amber/30 hover:shadow-lg hover:shadow-amber/5 relative group';

            // Get file icon and color based on type
            const typeMap = {
                'pdf': { icon: 'picture_as_pdf', color: 'text-red-400', bg: 'bg-red-500/10' },
                'docx': { icon: 'article', color: 'text-blue-400', bg: 'bg-blue-500/10' },
                'txt': { icon: 'text_snippet', color: 'text-gray-400', bg: 'bg-gray-500/10' }
            };
            const fileType = doc.doc_type?.toLowerCase() || 'txt';
            const typeInfo = typeMap[fileType] || typeMap['txt'];

            // Calculate estimated file size (rough estimate based on chunks)
            const estimatedSize = this.formatFileSize(doc.chunk_count * 500);

            // Simulated upload time (use doc_id timestamp or current time)
            const uploadTime = this.getUploadTime(doc.doc_id);

            docEl.innerHTML = `
                <!-- Hover glow effect -->
                <div class="absolute inset-0 bg-gradient-to-r from-amber/0 via-amber/5 to-amber/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>
                
                <div class="p-3.5 flex justify-between items-start cursor-pointer hover:bg-white/[0.03] transition-all duration-200 diag-doc-header relative z-10">
                    <div class="flex items-start gap-3 flex-grow min-w-0">
                        <!-- File Icon with type badge -->
                        <div class="relative flex-shrink-0">
                            <div class="${typeInfo.bg} rounded-lg p-2 border border-white/10 group-hover:scale-110 transition-transform duration-300">
                                <span class="material-symbols-outlined ${typeInfo.color} text-[20px]">${typeInfo.icon}</span>
                            </div>
                        </div>
                        
                        <div class="flex flex-col gap-1.5 flex-grow min-w-0">
                            <span class="text-[13px] font-semibold text-white truncate" title="${doc.filename}">${doc.filename}</span>
                            
                            <!-- Metadata row -->
                            <div class="flex items-center gap-2 flex-wrap text-[10px] font-body text-gray-500">
                                <div class="flex items-center gap-1">
                                    <span class="material-symbols-outlined text-[12px]">schedule</span>
                                    <span>${uploadTime}</span>
                                </div>
                                <span class="text-white/20">•</span>
                                <div class="flex items-center gap-1">
                                    <span class="material-symbols-outlined text-[12px]">data_usage</span>
                                    <span>~${estimatedSize}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="flex items-center gap-2 flex-shrink-0">
                        <span class="text-[10px] font-body text-amber/90 bg-amber/15 px-2 py-1 rounded-md border border-amber/25 font-semibold group-hover:bg-amber/20 transition-colors">${doc.chunk_count} chunks</span>
                        <span class="material-symbols-outlined text-amber/70 transition-all duration-300 expand-icon group-hover:text-amber">expand_more</span>
                    </div>
                </div>
                
                <!-- Expanded content area -->
                <div class="diag-doc-content hidden flex flex-col gap-2 bg-black/30 border-t border-white/10">
                    <div class="p-3">
                        <div class="text-center text-xs text-taupe loading-chunks py-4 hidden">
                            <span class="material-symbols-outlined animate-spin text-amber mb-2 inline-block">sync</span>
                            <p class="text-gray-400">Loading chunk previews...</p>
                        </div>
                        <div class="chunks-list flex flex-col gap-2.5 max-h-[280px] overflow-y-auto custom-scrollbar pr-2 hidden"></div>
                    </div>
                </div>
            `;

            const header = docEl.querySelector('.diag-doc-header');
            const content = docEl.querySelector('.diag-doc-content');
            const expandIcon = docEl.querySelector('.expand-icon');
            const loading = docEl.querySelector('.loading-chunks');
            const chunksList = docEl.querySelector('.chunks-list');
            let fetched = false;

            header.onclick = async () => {
                const isExpanded = !content.classList.contains('hidden');

                if (isExpanded) {
                    content.classList.add('hidden');
                    expandIcon.style.transform = 'rotate(0deg)';
                } else {
                    content.classList.remove('hidden');
                    expandIcon.style.transform = 'rotate(180deg)';

                    if (!fetched) {
                        fetched = true;
                        loading.classList.remove('hidden');

                        try {
                            const res = await fetch(`/api/documents/${doc.doc_id}/chunks?session_id=${App.sessionId}`);
                            const data = await res.json();

                            loading.classList.add('hidden');
                            chunksList.classList.remove('hidden');

                            if (data.chunks && data.chunks.length > 0) {
                                data.chunks.forEach(c => {
                                    const chunkEl = document.createElement('div');
                                    chunkEl.className = 'bg-white/5 p-3 rounded-lg border border-white/10 text-xs font-body text-gray-300 leading-relaxed break-words whitespace-pre-wrap shadow-inner';
                                    chunkEl.innerHTML = `
                                        <div class="text-[10px] text-amber mb-2 uppercase tracking-widest border-b border-white/5 pb-1 flex justify-between">
                                            <span>Chunk #${c.chunk_index}</span>
                                            <span class="text-gray-500">Pinecone ID: ${doc.doc_id}-${c.chunk_index - 1}</span>
                                        </div>
                                        ${c.text}
                                    `;
                                    chunksList.appendChild(chunkEl);
                                });
                            } else {
                                chunksList.innerHTML = '<div class="text-center text-xs text-red-400 py-2">No chunks found.</div>';
                            }
                        } catch (err) {
                            loading.classList.add('hidden');
                            chunksList.classList.remove('hidden');
                            chunksList.innerHTML = '<div class="text-center text-xs text-red-400 py-2">Failed to load chunks.</div>';
                        }
                    }
                }
            };

            container.appendChild(docEl);
        });
    },

    // Helper: Format file size from bytes
    formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    },

    // Helper: Get relative upload time from doc_id
    getUploadTime(docId) {
        // Try to extract timestamp from doc_id if it contains one
        // Otherwise return a relative time
        const now = Date.now();
        const match = docId.match(/(\d{13})/); // Look for 13-digit timestamp

        if (match) {
            const timestamp = parseInt(match[1]);
            const diff = now - timestamp;
            const minutes = Math.floor(diff / 60000);
            const hours = Math.floor(minutes / 60);
            const days = Math.floor(hours / 24);

            if (minutes < 1) return 'Just now';
            if (minutes < 60) return `${minutes}m ago`;
            if (hours < 24) return `${hours}h ago`;
            return `${days}d ago`;
        }

        // Fallback: show "Recently"
        return 'Recently';
    }
};

window.addEventListener('DOMContentLoaded', () => Dashboard.init());
