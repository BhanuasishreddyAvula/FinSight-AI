/* sidebar.js - Collapsible Sidebar with Tooltips, Active States, and Accessibility */

const Sidebar = {
    activeShimmers: new Map(), // Tracks active upload shimmers universally
    sourcesList: [],
    tooltipEl: null,
    tooltipInitialized: false,

    init() {
        const toggleBtn = document.getElementById('sidebar-toggle');
        const sidebar = document.getElementById('app-sidebar');
        const mainCanvas = document.getElementById('app-canvas');
        const tooltip = document.getElementById('sidebar-tooltip');

        this.tooltipEl = tooltip;

        if (!toggleBtn || !sidebar) return;

        // ── Toggle handler ──
        toggleBtn.onclick = () => this.toggle(sidebar, mainCanvas);

        // ── Keyboard shortcut: Ctrl+B to toggle ──
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'b') {
                e.preventDefault();
                this.toggle(sidebar, mainCanvas);
            }
        });

        // ── Initialize universal tooltips once for all sidebars ──
        if (!this.tooltipInitialized) {
            this.initUniversalTooltips();
            this.tooltipInitialized = true;
        }

        // ── Keyboard navigation ──
        this.initKeyboardNav(sidebar);

        // ── Fetch documents list ──
        this.loadDocuments();

        // ── Tablet Tab Logic ──
        this.initTabletTabs();
    },

    initTabletTabs() {
        // Wire up backdrop
        const backdrop = document.getElementById('tablet-sidebar-backdrop');
        if (backdrop) {
            backdrop.addEventListener('click', () => {
                document.body.setAttribute('data-active-tab', 'canvas');
            });
        }
    },

    toggle(sidebar) {
        const isCollapsed = sidebar.classList.toggle('collapsed');
        document.body.classList.toggle('left-collapsed', isCollapsed);

        // Prevent scrollbar flicker during transition
        const nav = sidebar.querySelector('nav');
        if (nav) {
            nav.classList.add('transitioning');
            setTimeout(() => nav.classList.remove('transitioning'), 350);
        }
    },

    /* ═══════════════════════════════════════════════
       Universal Tooltips — handles both sidebars
       ═══════════════════════════════════════════════ */

    initUniversalTooltips() {
        if (!this.tooltipEl) return;

        let currentButton = null;
        let showTimeout = null;
        let hideTimeout = null;

        const showTooltip = (btn, sidebar) => {
            // Clear any pending hide
            if (hideTimeout) {
                clearTimeout(hideTimeout);
                hideTimeout = null;
            }

            const label = btn.getAttribute('data-tooltip');
            if (!label) return;

            // Restore display first
            this.tooltipEl.style.display = 'block';

            const rect = btn.getBoundingClientRect();
            this.tooltipEl.textContent = label;

            const isRightSidebar = sidebar.id === 'right-sidebar' || sidebar.classList.contains('right-sidebar');
            if (isRightSidebar) {
                this.tooltipEl.style.left = 'auto';
                this.tooltipEl.style.right = `${window.innerWidth - rect.left + 10}px`;
            } else {
                this.tooltipEl.style.right = 'auto';
                this.tooltipEl.style.left = `${rect.right + 10}px`;
            }

            this.tooltipEl.style.top = `${rect.top + rect.height / 2 - 14}px`;
            this.tooltipEl.classList.add('visible');
        };

        const hideTooltip = () => {
            // Immediately remove to prevent any interaction during transition
            if (hideTimeout) {
                clearTimeout(hideTimeout);
            }
            this.tooltipEl.classList.remove('visible');
            // Hide immediately by removing from layout
            this.tooltipEl.style.display = 'none';
            this.tooltipEl.style.left = '';
            this.tooltipEl.style.right = '';
            currentButton = null;
        };

        // Use mouseenter on buttons directly (no capture phase)
        document.addEventListener('mouseenter', (e) => {
            if (!(e.target instanceof Element)) return;
            const btn = e.target.closest('button[data-tooltip]');
            if (!btn) return;

            // Find which sidebar this button belongs to
            const sidebar = btn.closest('#app-sidebar, #right-sidebar');

            // Only show tooltip if sidebar exists and is collapsed
            if (!sidebar || !sidebar.classList.contains('collapsed')) {
                hideTooltip();
                return;
            }

            // If same button, do nothing
            if (btn === currentButton) return;

            currentButton = btn;

            // Clear any pending show timeout
            if (showTimeout) {
                clearTimeout(showTimeout);
            }

            // Show immediately or with tiny delay to debounce
            showTimeout = setTimeout(() => showTooltip(btn, sidebar), 100);

        }, true);

        // Hide tooltip on mouseleave
        document.addEventListener('mouseleave', (e) => {
            if (!(e.target instanceof Element)) return;
            const btn = e.target.closest('button[data-tooltip]');
            if (!btn || btn !== currentButton) return;
            
            hideTimeout = setTimeout(() => {
                hideTooltip();
            }, 100);
        }, true);
    },

    hideTooltip() {
        if (this.tooltipEl) {
            this.tooltipEl.classList.remove('visible');
            this.tooltipEl.style.left = '';
            this.tooltipEl.style.right = '';
        }
    },


    /* ═══════════════════════════════════════════════
       Keyboard Navigation
       ═══════════════════════════════════════════════ */

    initKeyboardNav(sidebar) {
        sidebar.addEventListener('keydown', (e) => {
            const focusable = sidebar.querySelectorAll('button:not([disabled]), [tabindex]:not([tabindex="-1"])');
            const arr = Array.from(focusable);
            const idx = arr.indexOf(document.activeElement);

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                const next = idx < arr.length - 1 ? idx + 1 : 0;
                arr[next].focus();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                const prev = idx > 0 ? idx - 1 : arr.length - 1;
                arr[prev].focus();
            } else if (e.key === 'Enter' || e.key === ' ') {
                if (document.activeElement.tagName === 'BUTTON') {
                    e.preventDefault();
                    document.activeElement.click();
                }
            }
        });
    },

    /* ═══════════════════════════════════════════════
       Source Documents
       ═══════════════════════════════════════════════ */

    async loadDocuments() {
        const container = document.getElementById('sources-list-container');
        if (!container) return;

        try {
            const res = await fetch(`${App.apiBase}/api/documents?session_id=${App.sessionId}`);
            if (!res.ok) throw new Error("Failed to load documents.");
            const data = await res.json();
            this.sourcesList = data.documents;
            this.renderDocuments(data.documents);
        } catch (err) {
            console.error("Error loading sources:", err);
            container.innerHTML = `<div class="px-4 py-2 text-red-400/70 font-body text-xs sidebar-text">Failed to load sources.</div>`;
        }
    },

    renderDocuments(docs) {
        const container = document.getElementById('sources-list-container');
        if (!container) return;

        container.innerHTML = '';

        // Universally preserve and render active shimmers at the top
        this.activeShimmers.forEach((card) => {
            container.appendChild(card);
        });

        if ((!docs || docs.length === 0) && this.activeShimmers.size === 0) {
            container.innerHTML = `<div class="px-3 py-2 text-gray-500 text-sm sidebar-text">No sources yet</div>`;
            return;
        }

        docs.forEach(doc => {
            const card = this.createCardElement(doc);
            container.appendChild(card);
        });
    },

    createCardElement(doc) {
        const card = document.createElement('div');

        const typeMap = {
            'pdf': { icon: 'picture_as_pdf', color: 'text-red-400' },
            'docx': { icon: 'article', color: 'text-blue-400' },
            'txt': { icon: 'text_snippet', color: 'text-gray-400' }
        };
        const map = typeMap[doc.doc_type?.toLowerCase()] || { icon: 'description', color: 'text-[#E5E5E5]' };
        const fileIcon = map.icon;
        const iconColor = map.color;

        card.className = "sidebar-doc-card group/card relative flex items-center justify-start gap-3 text-[#E5E5E5] transition-all rounded-lg px-2 py-2 hover:bg-white/5 text-[13px] h-[36px] cursor-default";
        card.title = doc.filename;
        card.setAttribute('data-tooltip', doc.filename);
        card.setAttribute('aria-label', doc.filename);
        card.innerHTML = `
            <span class="material-symbols-outlined text-[20px] ${iconColor}">${fileIcon}</span>
            <span class="truncate sidebar-text select-none text-left flex-grow" title="${doc.filename}">${doc.filename}</span>
            <div class="delete-doc-btn p-1 text-gray-500 hover:text-gray-200 rounded transition-all shrink-0 cursor-pointer opacity-0 group-hover/card:opacity-100 flex items-center justify-center" data-id="${doc.doc_id}" aria-label="Delete ${doc.filename}">
                <span class="material-symbols-outlined text-[16px]">close</span>
            </div>
        `;

        const deleteBtn = card.querySelector('.delete-doc-btn');
        deleteBtn.onclick = async (e) => {
            e.stopPropagation();
            const isConfirmed = await App.confirm(`Delete document "${doc.filename}"? This will remove all chunks and history references.`, "Delete Document", "Delete", "Cancel");
            if (isConfirmed) {
                card.remove();
                this.deleteDocument(doc.doc_id, doc.filename);
            }
        };

        return card;
    },

    addDocumentCard(doc) {
        const container = document.getElementById('sources-list-container');
        if (!container) return;

        const emptyState = container.querySelector('.text-gray-500');
        if (emptyState) emptyState.remove();

        if (!this.sourcesList) this.sourcesList = [];
        this.sourcesList.push(doc);

        const card = this.createCardElement(doc);
        container.appendChild(card);
    },

    addShimmerCard(filename) {
        const container = document.getElementById('sources-list-container');
        if (!container) return;

        const emptyState = container.querySelector('.text-gray-500');
        if (emptyState) emptyState.remove();

        const shimmerId = 'shimmer-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
        const card = document.createElement('div');
        card.id = shimmerId;
        card.className = "group/card relative flex items-center justify-start gap-3 transition-all rounded-lg px-2 py-2 cursor-wait text-[13px] h-[36px] overflow-hidden shimmer-bar";
        card.setAttribute('data-filename', filename);

        let fileIcon = 'description';
        const lowerName = filename.toLowerCase();
        if (lowerName.endsWith('.pdf')) fileIcon = 'picture_as_pdf';
        else if (lowerName.endsWith('.docx')) fileIcon = 'article';
        else if (lowerName.endsWith('.txt')) fileIcon = 'text_snippet';

        card.innerHTML = `
            <span class="material-symbols-outlined text-[20px] text-amber animate-pulse">${fileIcon}</span>
            <span class="truncate sidebar-text select-none text-left flex-grow text-amber/80 font-medium animate-pulse" title="Processing: ${filename}">${filename}</span>
        `;

        container.prepend(card);
        this.activeShimmers.set(filename, card);
    },

    removeShimmerCard(filename) {
        this.activeShimmers.delete(filename);
        const container = document.getElementById('sources-list-container');
        if (!container) return;

        const cards = container.querySelectorAll('div[id^="shimmer-"]');
        cards.forEach(card => {
            if (card.getAttribute('data-filename') === filename) {
                card.remove();
            }
        });
    },

    async deleteDocument(docId, filename) {
        App.showToast(`Document "${filename}" deleted successfully.`, 'success');

        try {
            const res = await fetch(`${App.apiBase}/api/documents/${docId}?session_id=${App.sessionId}`, {
                method: 'DELETE'
            });
            if (!res.ok) throw new Error("Delete request failed.");

            await this.loadDocuments();
            Chat.resetChatUI();
        } catch (err) {
            console.error("Delete error:", err);
            App.showToast(`Failed to delete document: ${err.message}`, 'error');
            this.loadDocuments();
        }
    },
};

const RightSidebar = {
    toggle() {
        const sidebar = document.getElementById('right-sidebar');
        if (!sidebar) return;

        const isCollapsed = sidebar.classList.toggle('collapsed');
        document.body.classList.toggle('right-collapsed', isCollapsed);
    },

    init() {
        const sidebar = document.getElementById('right-sidebar');
        if (!sidebar) return;

        // Tooltips are now handled universally by Sidebar.initUniversalTooltips()

        // Close diagnostics modal on backdrop click
        const diagModal = document.getElementById('diagnostics-modal');
        if (diagModal) {
            diagModal.onclick = (e) => {
                if (e.target === diagModal) this.closeDiagnosticsModal();
            };
        }

        // Initialize tab switching
        this.initTabSwitching();
    },

    initTabSwitching() {
        const radioInputs = document.querySelectorAll('input[name="diag-tab-radio"]');
        const tabContents = document.querySelectorAll('.diag-tab-content');
        const tabTitle = document.getElementById('diag-active-tab-title');

        const tabTitles = {
            'overview': 'Overview',
            'documents': 'Documents',
            'performance': 'Performance'
        };

        radioInputs.forEach(radio => {
            radio.addEventListener('change', () => {
                if (!radio.checked) return;

                const targetTab = radio.getAttribute('data-tab');

                // Hide all tab contents
                tabContents.forEach(c => c.classList.add('hidden'));

                // Show the selected tab content
                const targetContent = document.querySelector(`[data-content="${targetTab}"]`);
                if (targetContent) {
                    targetContent.classList.remove('hidden');
                }

                // Update header subtitle (active tab indicator)
                if (tabTitle && tabTitles[targetTab]) {
                    tabTitle.textContent = tabTitles[targetTab].toUpperCase();
                }
            });
        });

        // Set role="tablist" on parent container
        const tabContainer = document.querySelector('.diag-tab-container');
        if (tabContainer) {
            tabContainer.setAttribute('role', 'tablist');
        }

        // Set initial ARIA attributes on labels
        const labels = document.querySelectorAll('.diag-tab-container label');
        labels.forEach((label, index) => {
            label.setAttribute('role', 'tab');
            const radio = radioInputs[index];
            label.setAttribute('aria-selected', radio?.checked ? 'true' : 'false');
        });
    },


    openDiagnosticsModal() {
        const modal = document.getElementById('diagnostics-modal');
        if (!modal) return;

        // Populate Diagnostics fields
        const diagSessionId = document.getElementById('diag-session-id');
        const diagDocCount = document.getElementById('diag-doc-count');
        const diagDocsContainer = document.getElementById('diag-docs-container');

        // Remove skeleton and show session ID with smooth fade
        if (diagSessionId) {
            diagSessionId.classList.remove('diag-skeleton');
            diagSessionId.textContent = App.sessionId;
            diagSessionId.style.opacity = '0';
            setTimeout(() => {
                diagSessionId.style.transition = 'opacity 0.4s ease';
                diagSessionId.style.opacity = '1';
            }, 50);
        }

        // Animated counter for document count
        if (diagDocCount && typeof Sidebar !== 'undefined') {
            const targetCount = Sidebar.sourcesList.length;
            diagDocCount.setAttribute('data-target', targetCount);
            this.animateCounter(diagDocCount, 0, targetCount, 800);
        }

        // Update system status indicators
        this.updateSystemStatus();

        // Start live activity tracking
        this.startActivityTracking();

        // Render documents in both Overview and Documents tab
        if (diagDocsContainer && typeof Dashboard !== 'undefined') {
            Dashboard.renderDiagnosticDocs(diagDocsContainer);
        }

        const diagDocsTabContainer = document.getElementById('diag-docs-container-tab');
        if (diagDocsTabContainer && typeof Dashboard !== 'undefined') {
            Dashboard.renderDiagnosticDocs(diagDocsTabContainer);
        }

        // Load documents and chunks for Documents tab
        this.loadDocumentsTab();

        modal.classList.remove('hidden');
        requestAnimationFrame(() => modal.classList.add('active'));
    },

    async loadDocumentsTab() {
        try {
            const res = await fetch(`${App.apiBase}/api/documents?session_id=${App.sessionId}`);
            if (!res.ok) throw new Error("Failed to load documents.");
            const data = await res.json();

            this.populateDocumentsList(data.documents);
        } catch (err) {
            console.error("Error loading documents tab:", err);
        }
    },

    populateDocumentsList(documents) {
        const docListContainer = document.getElementById('diag-doc-list');

        if (!docListContainer) return;

        // Clear and populate document list
        docListContainer.innerHTML = '';

        if (documents.length === 0) {
            docListContainer.innerHTML = `
                <div class="flex flex-col items-center justify-center py-8 gap-2">
                    <span class="material-symbols-outlined text-[28px] text-gray-600">description</span>
                    <div class="text-[11px] text-gray-500 text-center">No documents</div>
                </div>
            `;
            return;
        }

        // Get file type icon and color
        const getFileTypeInfo = (filename) => {
            const ext = filename.split('.').pop()?.toLowerCase();
            const typeMap = {
                'pdf': { icon: 'picture_as_pdf', color: 'text-red-400' },
                'docx': { icon: 'article', color: 'text-blue-400' },
                'doc': { icon: 'article', color: 'text-blue-400' },
                'txt': { icon: 'text_snippet', color: 'text-gray-400' }
            };
            return typeMap[ext] || { icon: 'description', color: 'text-gray-400' };
        };

        documents.forEach((doc, index) => {
            const fileInfo = getFileTypeInfo(doc.filename);
            const docItem = document.createElement('button');
            docItem.className = 'doc-item-diag px-3 py-2.5 rounded-lg bg-white/[0.02] hover:bg-white/[0.06] border border-white/5 hover:border-amber/30 transition-all duration-200 cursor-pointer text-left flex items-center gap-2.5 w-full';

            docItem.innerHTML = `
                <span class="material-symbols-outlined text-[20px] ${fileInfo.color} shrink-0">${fileInfo.icon}</span>
                <div class="flex-grow min-w-0">
                    <div class="text-[12px] text-white font-medium truncate mb-0.5" title="${doc.filename}">${doc.filename}</div>
                    <div class="text-[10px] text-gray-500 font-body">${doc.chunk_count || 0} chunks</div>
                </div>
            `;

            docItem.onclick = () => this.loadDocumentChunks(doc.doc_id, doc.filename, docItem);

            docListContainer.appendChild(docItem);
        });
    },

    async loadDocumentChunks(docId, filename, docItem) {
        const chunksContainer = document.getElementById('diag-chunks-container');
        if (!chunksContainer) return;

        // Highlight selected document
        document.querySelectorAll('.doc-item-diag').forEach(item => {
            item.classList.remove('bg-amber/10', 'border-amber/40');
            item.classList.add('bg-white/[0.02]', 'border-white/5');
        });
        docItem.classList.remove('bg-white/[0.02]', 'border-white/5');
        docItem.classList.add('bg-amber/10', 'border-amber/40');

        // Show loading state - centered spinner only
        chunksContainer.innerHTML = `
            <div class="absolute inset-0 flex items-center justify-center">
                <div class="spinner center scale-75">
                    <div class="spinner-blade"></div>
                    <div class="spinner-blade"></div>
                    <div class="spinner-blade"></div>
                    <div class="spinner-blade"></div>
                    <div class="spinner-blade"></div>
                    <div class="spinner-blade"></div>
                    <div class="spinner-blade"></div>
                    <div class="spinner-blade"></div>
                    <div class="spinner-blade"></div>
                    <div class="spinner-blade"></div>
                    <div class="spinner-blade"></div>
                    <div class="spinner-blade"></div>
                </div>
            </div>
        `;

        try {
            const res = await fetch(`${App.apiBase}/api/documents/${docId}/chunks?session_id=${App.sessionId}`);
            if (!res.ok) throw new Error("Failed to load chunks.");
            const data = await res.json();

            this.renderChunks(data.chunks, filename);
        } catch (err) {
            console.error("Error loading chunks:", err);
            chunksContainer.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full gap-3 text-center">
                    <span class="material-symbols-outlined text-[32px] text-red-400">error</span>
                    <div class="text-[13px] text-red-400">Failed to load chunks</div>
                    <div class="text-[11px] text-gray-600">${err.message}</div>
                </div>
            `;
        }
    },

    renderChunks(chunks, filename) {
        const chunksContainer = document.getElementById('diag-chunks-container');
        if (!chunksContainer) return;

        chunksContainer.innerHTML = '';

        if (chunks.length === 0) {
            chunksContainer.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full gap-3 text-center">
                    <span class="material-symbols-outlined text-[32px] text-gray-600">notes</span>
                    <div class="text-[13px] text-gray-500">No chunks found</div>
                </div>
            `;
            return;
        }

        chunks.forEach((chunk, index) => {
            const chunkCard = document.createElement('div');
            chunkCard.className = 'chunk-card';

            // Create chunk header with number
            const chunkHeader = document.createElement('div');
            chunkHeader.className = 'chunk-header';

            const chunkNumber = document.createElement('div');
            chunkNumber.className = 'chunk-number';
            chunkNumber.textContent = `CHUNK ${index + 1}`;

            chunkHeader.appendChild(chunkNumber);

            // Create content wrapper
            const chunkContent = document.createElement('div');
            chunkContent.className = 'chunk-card-content';

            const chunkText = document.createElement('div');
            chunkText.className = 'chunk-text preview';
            chunkText.textContent = chunk.text || chunk.content || '';

            const seeMoreBtn = document.createElement('button');
            seeMoreBtn.className = 'chunk-see-more';
            seeMoreBtn.textContent = 'See more';

            // Toggle expand/collapse ONLY on button click
            const toggleExpand = (e) => {
                e.stopPropagation(); // Prevent event bubbling
                const isExpanded = chunkText.classList.contains('full');

                if (isExpanded) {
                    chunkText.classList.remove('full');
                    chunkText.classList.add('preview');
                    chunkCard.classList.remove('expanded');
                    seeMoreBtn.textContent = 'See more';
                } else {
                    chunkText.classList.remove('preview');
                    chunkText.classList.add('full');
                    chunkCard.classList.add('expanded');
                    seeMoreBtn.textContent = 'See less';
                }
            };

            // Only trigger on button click
            seeMoreBtn.onclick = toggleExpand;

            // Assemble the card
            chunkContent.appendChild(chunkText);
            chunkContent.appendChild(seeMoreBtn);

            chunkCard.appendChild(chunkHeader);
            chunkCard.appendChild(chunkContent);
            chunksContainer.appendChild(chunkCard);
        });
    },


    updateSystemStatus() {
        // Check backend connection
        fetch(`${App.apiBase}/api/health`)
            .then(res => res.ok ? 'Connected' : 'Error')
            .catch(() => 'Disconnected')
            .then(status => {
                const el = document.getElementById('backend-status');
                const badge = document.getElementById('status-badge');
                if (el) {
                    el.textContent = status;
                    el.className = status === 'Connected'
                        ? 'text-[11px] text-green-400 font-semibold'
                        : 'text-[11px] text-red-400 font-semibold';
                }
                // Update main status badge
                if (badge && status !== 'Connected') {
                    badge.className = 'flex items-center gap-1.5 px-2 py-1 rounded-full bg-red-500/10 border border-red-500/30';
                    badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span><span class="text-[9px] text-red-400 font-body font-semibold">ERROR</span>';
                }
            });

        // Simulate Vector DB status (always active if backend is up)
        const vectorEl = document.getElementById('vectordb-status');
        if (vectorEl) {
            vectorEl.textContent = 'Active';
            vectorEl.className = 'text-[11px] text-green-400 font-semibold';
        }
    },

    startActivityTracking() {
        const updateActivity = () => {
            const activityEl = document.getElementById('last-activity');
            if (!activityEl) return;

            // Get last activity time from App state or use current time
            const lastTime = App.lastActivityTime || Date.now();
            const relativeTime = this.getRelativeTime(lastTime);

            activityEl.textContent = relativeTime;
        };

        // Update immediately
        updateActivity();

        // Update every 10 seconds while modal is open
        if (this.activityInterval) {
            clearInterval(this.activityInterval);
        }
        this.activityInterval = setInterval(updateActivity, 10000);
    },

    getRelativeTime(timestamp) {
        const now = Date.now();
        const diff = now - timestamp;
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (seconds < 10) return 'Just now';
        if (seconds < 60) return `${seconds} seconds ago`;
        if (minutes === 1) return '1 minute ago';
        if (minutes < 60) return `${minutes} minutes ago`;
        if (hours === 1) return '1 hour ago';
        if (hours < 24) return `${hours} hours ago`;
        if (days === 1) return '1 day ago';
        return `${days} days ago`;
    },

    // Animated counter utility
    animateCounter(element, start, end, duration) {
        const startTime = performance.now();
        const range = end - start;

        const updateCounter = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Easing function (easeOutExpo)
            const easeProgress = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
            const current = Math.floor(start + range * easeProgress);

            element.textContent = current;

            if (progress < 1) {
                requestAnimationFrame(updateCounter);
            }
        };

        requestAnimationFrame(updateCounter);
    },

    closeDiagnosticsModal() {
        const modal = document.getElementById('diagnostics-modal');
        if (!modal) return;

        // Clear activity tracking interval
        if (this.activityInterval) {
            clearInterval(this.activityInterval);
            this.activityInterval = null;
        }

        modal.classList.remove('active');
        setTimeout(() => modal.classList.add('hidden'), 300);
    }
};

window.addEventListener('DOMContentLoaded', () => {
    Sidebar.init();
    RightSidebar.init();
});
