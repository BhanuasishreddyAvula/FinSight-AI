/* app.js - Global State Management, Core Utilities, and Toast Notifications */

/**
 * Universal Mobile Viewport Fix
 * Dynamically calculates the exact visible height (ignoring address/gesture bars)
 * and sets a --vh CSS variable.
 */
function adjustMobileViewport() {
    let vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
}
window.addEventListener('resize', adjustMobileViewport);
window.addEventListener('orientationchange', adjustMobileViewport);
adjustMobileViewport();

/**
 * Universal Dynamic Chat Offset — Mobile First
 * Calculates the exact height of the mobile header so chat messages
 * always appear right below it, never hidden behind it.
 * Works on EVERY mobile device by reading real DOM dimensions.
 */
function adjustChatOffset() {
    const header = document.querySelector('.app-header');
    const chatContainer = document.getElementById('chat-thread-container');
    if (!header || !chatContainer) return;

    // On desktop (>=1024px) the header is hidden, so use the fallback padding.
    if (window.innerWidth >= 1024) {
        document.documentElement.style.setProperty('--chat-header-offset', '24px');
        return;
    }

    // On mobile: measure the header's actual rendered height.
    // This accounts for safe-areas, notch heights, dynamic island, etc.
    const headerRect = header.getBoundingClientRect();
    const headerHeight = headerRect.height;

    // Also account for any top padding the header may have that we want to preserve below it.
    // Add a tiny breathing room (4px) so content doesn't stick exactly to the header bottom edge.
    const offset = headerHeight + 4;

    // Apply as CSS variable — this controls #chat-thread-container's padding-top.
    document.documentElement.style.setProperty('--chat-header-offset', `${offset}px`);
}

// Recalculate on any event that could change header dimensions.
window.addEventListener('resize', adjustChatOffset);
window.addEventListener('orientationchange', () => {
    // On orientation change, wait briefly for the browser to finish re-layout.
    setTimeout(adjustChatOffset, 150);
});
window.addEventListener('load', adjustChatOffset);
// Also watch the DOM in case the mobile nav buttons toggle visibility.
if (typeof MutationObserver !== 'undefined') {
    const headerObserver = new MutationObserver(adjustChatOffset);
    const appHeader = document.querySelector('.app-header');
    if (appHeader) {
        headerObserver.observe(appHeader, {
            attributes: true,
            childList: true,
            subtree: true
        });
    }
}
// Single-shot call on DOMContentLoaded in case init runs later.
document.addEventListener('DOMContentLoaded', adjustChatOffset);
// Also call it immediately in case DOM is already ready.
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    adjustChatOffset();
}

/**
 * Generate or retrieve a persistent device-level identifier.
 * This is stored in localStorage and NEVER changes — it uniquely
 * identifies this specific browser/device installation.
 * Used to isolate sessions per device so that sessions from one
 * device NEVER appear on another device.
 */
function getDeviceId() {
    let deviceId = localStorage.getItem('finsight_device_id');
    if (!deviceId) {
        // Generate a compact unique ID (8 chars, alphanumeric)
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let id = '';
        for (let i = 0; i < 8; i++) {
            id += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        deviceId = id;
        localStorage.setItem('finsight_device_id', deviceId);
    }
    return deviceId;
}

/**
 * Universal Dynamic Sidebar Footer Fix — Mobile First
 * Ensures the Settings button (left sidebar) and Live Diagnostics
 * button (right sidebar) are ALWAYS visible and never pushed
 * below the viewport on any mobile device.
 *
 * It works by measuring the sidebar's available inner height
 * and dynamically applying a max-height to the scrollable
 * content area so the footer stays pinned at the bottom.
 */
function adjustSidebarFooters() {
    if (window.innerWidth >= 1024) return; // Desktop unaffected

    const sidebars = [
        {
            sidebar: document.getElementById('app-sidebar'),
            scrollable: document.querySelector('aside.sidebar nav'),
            footer: document.querySelector('aside.sidebar .sidebar-footer'),
            handle: 'left'
        },
        {
            sidebar: document.getElementById('right-sidebar'),
            scrollable: document.querySelector('.custom-scrollbar-right'),
            footer: document.querySelector('.sidebar-footer-right'),
            handle: 'right'
        }
    ];

    sidebars.forEach(({ sidebar, scrollable, footer, handle }) => {
        if (!sidebar || !scrollable || !footer) return;

        // The sidebar might be off-screen (transform: translateX), but
        // getBoundingClientRect still gives us proper dimensions.
        // We need the sidebar's actual visible height on screen.
        const sidebarRect = sidebar.getBoundingClientRect();
        const sidebarHeight = sidebarRect.height;

        // Measure the footer height
        const footerRect = footer.getBoundingClientRect();
        const footerHeight = footerRect.height || 52; // fallback ~52px

        // Measure the header (brand area) inside the sidebar — the first flex child before the scrollable
        // We use the first child of the sidebar as the "fixed top" area
        const sidebarChildren = Array.from(sidebar.children);
        let topFixedHeight = 0;
        for (const child of sidebarChildren) {
            if (child === scrollable || child === footer) break;
            const childRect = child.getBoundingClientRect();
            topFixedHeight += childRect.height;
            // Account for margins/borders via computed style
            const cs = window.getComputedStyle(child);
            topFixedHeight += parseFloat(cs.marginBottom) || 0;
        }

        // Padding on the sidebar itself
        const sidebarCS = window.getComputedStyle(sidebar);
        const sidebarPaddingY = (parseFloat(sidebarCS.paddingTop) || 0) + (parseFloat(sidebarCS.paddingBottom) || 0);

        // Available height for scrollable content = sidebar height - topFixed - footer - sidebar padding
        const availableHeight = sidebarHeight - topFixedHeight - footerHeight - sidebarPaddingY;

        // Apply as max-height to the scrollable container
        scrollable.style.maxHeight = `${Math.max(availableHeight, 60)}px`; // minimum 60px
    });
}

// Recalculate on any event that could change sidebar dimensions
window.addEventListener('resize', adjustSidebarFooters);
window.addEventListener('orientationchange', () => {
    setTimeout(adjustSidebarFooters, 200);
});
window.addEventListener('load', adjustSidebarFooters);

// Use MutationObserver to watch both sidebars for content changes
if (typeof MutationObserver !== 'undefined') {
    const sidebarObserver = new MutationObserver(() => {
        requestAnimationFrame(adjustSidebarFooters);
    });

    const leftSidebar = document.getElementById('app-sidebar');
    const rightSidebar = document.getElementById('right-sidebar');

    if (leftSidebar) {
        sidebarObserver.observe(leftSidebar, {
            childList: true,
            subtree: true,
            attributes: false
        });
    }
    if (rightSidebar) {
        sidebarObserver.observe(rightSidebar, {
            childList: true,
            subtree: true,
            attributes: false
        });
    }
}

/**
 * Universal Mobile Composer Bottom Offset — Mobile First
 * Detects the mobile browser's bottom navigation chrome (3-button nav,
 * gesture navigation strip, home indicator, etc.) and dynamically
 * pushes the chat composer above it so it's NEVER hidden behind the
 * browser's UI on ANY mobile device.
 *
 * Uses the Visual Viewport API which tells us the exact visible area
 * excluding browser chrome, address bar, and bottom nav.
 */
function adjustComposerPosition() {
    if (window.innerWidth >= 1024) return; // Desktop unaffected

    const composer = document.querySelector('.composer-container');
    if (!composer) return;

    let bottomNavHeight = 0;

    // The Visual Viewport API is supported on all modern mobile browsers.
    // It gives us the actual visible area excluding browser chrome.
    if (window.visualViewport) {
        // The difference between window.innerHeight and visualViewport.height
        // is the total space taken by address bar + bottom nav chrome.
        // We only care about the bottom chrome (nav bar / gesture strip).
        // On most mobile browsers, this difference is ~48-80px.
        const totalChrome = window.innerHeight - window.visualViewport.height;

        // The address bar typically takes ~40-56px at the top.
        // The remaining height at the bottom is the bottom navigation chrome.
        // We use a heuristic: bottom nav is typically between 0 and 80px.
        // If totalChrome is small (< 40px), it's probably just the bottom
        // nav without address bar interference (e.g., page fully scrolled).
        // Otherwise, subtract ~50px estimated address bar height.
        if (totalChrome > 40) {
            bottomNavHeight = Math.max(0, totalChrome - 50);
        } else {
            bottomNavHeight = Math.max(0, totalChrome);
        }
    } else {
        // Fallback: on older devices, use a reasonable default of 48px
        // which covers most 3-button nav bars and gesture strips.
        bottomNavHeight = 48;
    }

    // Clamp between reasonable bounds
    bottomNavHeight = Math.max(0, Math.min(bottomNavHeight, 100));

    // Apply as CSS variable — composer-container uses this for mobile bottom offset.
    // We add the base 24px spacing + the detected bottom nav height.
    document.documentElement.style.setProperty('--composer-bottom-offset', `${bottomNavHeight + 24}px`);
}

// Recalculate whenever the viewport changes (orientation, scroll, address bar show/hide, etc.)
window.addEventListener('resize', adjustComposerPosition);
window.addEventListener('orientationchange', () => {
    setTimeout(adjustComposerPosition, 200);
});
window.addEventListener('load', adjustComposerPosition);

// The visual viewport `resize` event is the KEY event for detecting
// address bar show/hide and bottom nav changes on mobile.
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', adjustComposerPosition);
    window.visualViewport.addEventListener('scroll', adjustComposerPosition);
}

// Also update when the chat thread scrolls (address bar can hide/show on scroll)
const chatContainer = document.getElementById('chat-thread-container');
if (chatContainer) {
    chatContainer.addEventListener('scroll', () => {
        requestAnimationFrame(adjustComposerPosition);
    });
}

// Initial call
document.addEventListener('DOMContentLoaded', adjustComposerPosition);
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    adjustComposerPosition();
}

// Global Application State Namespace
const App = {
    // API Configurations - Auto-detect local vs cloud
    apiBase: (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
        ? window.location.origin
        : "https://finsight-ai-5nnb.onrender.com",
    config: {
        default_top_k: 5,
        default_alpha: 0.7,
        max_upload_size_mb: 25,
        allowed_extensions: [".txt", ".docx", ".pdf"]
    },

    // RAG Settings (Syncs with localStorage & settings slider)
    settings: {
        topK: parseInt(localStorage.getItem('finsight_topk')) || 5,
        alpha: parseFloat(localStorage.getItem('finsight_alpha')) || 0.7
    },

    // Session Management (UUID persists across page reloads)
    // Each session is prefixed with the device_id to isolate sessions
    // per device. This prevents sessions from one device leaking to
    // another device when the backend returns ALL sessions globally.
    // Format: dev_{device_id}_session_{uuid}
    sessionId: (() => {
        let sid = localStorage.getItem('finsight_session_id');
        if (!sid || !sid.startsWith('dev_')) {
            // Generate a new device-scoped session
            const deviceId = typeof getDeviceId === 'function' ? getDeviceId() : 'unknown';
            if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
                sid = 'dev_' + deviceId + '_session_' + crypto.randomUUID().replace(/-/g, '');
            } else {
                sid = 'dev_' + deviceId + '_session_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
            }
            localStorage.setItem('finsight_session_id', sid);
        }
        return sid;
    })(),



    // Core Initialization
    async init() {
        // First things first, let's establish our session! 
        // If they already have one stored locally, we'll just pick up right where they left off.
        console.log("FinSight AI Initializing... Session ID:", this.sessionId);

        // Next up, grab the dynamic config from our backend (things like file size limits)
        // so our frontend knows exactly what the server can handle.
        try {
            const res = await fetch(`${this.apiBase}/api/config`);
            if (res.ok) {
                this.config = await res.json();
                console.log("Loaded server configuration:", this.config);

                // If they haven't messed with the RAG parameters yet, let's load up the recommended defaults.
                if (!localStorage.getItem('finsight_topk') && this.config.default_top_k) {
                    this.settings.topK = this.config.default_top_k;
                }
                if (!localStorage.getItem('finsight_alpha') && this.config.default_alpha) {
                    this.settings.alpha = this.config.default_alpha;
                }
            }
        } catch (e) {
            console.warn("Failed to load server configuration, using defaults:", e);
        }

        // Render current session ID on header
        this.updateSessionHeader();

        // Load recent sessions list
        HistoryManager.loadSessions();
    },

    updateSessionHeader() {
        const sessionTag = document.getElementById('diag-session-id');
        if (sessionTag) {
            sessionTag.textContent = `${this.sessionId.substring(0, 18)}...`;
        }
    },

    startNewChat() {
        const deviceId = typeof getDeviceId === 'function' ? getDeviceId() : 'unknown';
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            this.sessionId = 'dev_' + deviceId + '_session_' + crypto.randomUUID().replace(/-/g, '');
        } else {
            this.sessionId = 'dev_' + deviceId + '_session_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        }
        localStorage.setItem('finsight_session_id', this.sessionId);

        this.updateSessionHeader();

        // Clear chat UI
        if (typeof Chat !== 'undefined') {
            Chat.resetChatUI();
        }

        // Clear documents UI
        if (typeof Sidebar !== 'undefined') {
            Sidebar.sourcesList = [];

            const container = document.getElementById('sources-list-container');
            if (container) container.innerHTML = '<div class="px-2 py-2 text-gray-500 text-sm sidebar-text">No sources yet</div>';

            const docCount = document.getElementById('diag-doc-count');
            if (docCount) docCount.textContent = '0';

            const diagDocs = document.getElementById('diag-docs-container');
            if (diagDocs) diagDocs.innerHTML = '<div class="text-center text-taupe/60 italic py-4 text-xs bg-white/[0.02] rounded-xl border border-white/5 border-dashed">No documents uploaded.</div>';

            const diagChunks = document.getElementById('diag-chunks-container');
            if (diagChunks) diagChunks.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full gap-3 text-center py-12">
                    <span class="material-symbols-outlined text-[40px] text-gray-600">notes</span>
                    <div class="text-[14px] text-gray-400 font-medium">Select a document to view chunks</div>
                    <div class="text-[11px] text-gray-600">Click on any document from the left sidebar</div>
                </div>
            `;
        }

        // Reload recent list silently (no skeletons)
        HistoryManager.loadSessions(false);
    },

    // Toast Notification System
    showToast(message, type = 'success', duration = 4000) {
        const container = document.getElementById('toast-container');
        if (!container) return;

        // Map icons & border styles
        let iconName = 'check_circle';
        let borderClass = 'border-[#6FCF97]/30';
        let barClass = 'bg-[#6FCF97]';
        let iconColor = 'text-[#6FCF97]';

        if (type === 'error') {
            iconName = 'warning';
            borderClass = 'border-[#FFB4AB]/30';
            barClass = 'bg-[#FFB4AB]';
            iconColor = 'text-[#FFB4AB]';
        } else if (type === 'indexing') {
            iconName = 'hourglass_empty';
            borderClass = 'border-[#D4AF37]/30';
            barClass = 'bg-[#D4AF37]';
            iconColor = 'text-[#D4AF37]';
        } else if (type === 'neutral') {
            iconName = 'info';
            borderClass = 'border-amber/20';
            barClass = 'bg-amber';
            iconColor = 'text-amber';
        }

        // Create notification card
        const toast = document.createElement('div');
        toast.className = `glass-panel ${borderClass} w-max max-w-[320px] px-4 py-3 rounded-2xl relative shadow-lg pointer-events-auto animate-toast overflow-hidden`;

        toast.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="w-6 h-6 rounded-full bg-void flex items-center justify-center shrink-0">
                    <span class="material-symbols-outlined ${iconColor} text-[18px] ${type === 'indexing' ? 'animate-spin-custom' : ''}">${iconName}</span>
                </div>
                <div class="flex-grow">
                    <p class="text-sm font-medium text-parchment leading-tight">${message}</p>
                </div>
                <button class="toast-close-btn text-taupe hover:text-parchment cursor-pointer shrink-0 ml-1">
                    <span class="material-symbols-outlined text-[16px]">close</span>
                </button>
            </div>
            <div class="absolute bottom-0 left-0 right-0 h-[3px] bg-white/5">
                <div class="toast-progress ${barClass} h-full w-full transition-all linear"></div>
            </div>
        `;

        container.appendChild(toast);

        // Close action
        const closeBtn = toast.querySelector('.toast-close-btn');
        closeBtn.onclick = () => this.dismissToast(toast);

        const toastDuration = duration || this.config.toast_duration || 4000;

        // Progress bar countdown
        const progress = toast.querySelector('.toast-progress');
        progress.style.transitionDuration = `${toastDuration}ms`;
        // Use a timeout to trigger CSS transition
        setTimeout(() => {
            progress.style.width = '0%';
        }, 50);

        // Auto dismiss
        const timeoutId = setTimeout(() => {
            this.dismissToast(toast);
        }, toastDuration);

        toast.dataset.timeoutId = timeoutId;
        return toast;
    },

    dismissToast(toast) {
        if (toast.dataset.timeoutId) {
            clearTimeout(toast.dataset.timeoutId);
        }
        toast.style.transform = 'translateX(120%)';
        toast.style.opacity = '0';
        toast.style.transition = 'all 0.3s cubic-bezier(0.25, 1, 0.5, 1)';
        setTimeout(() => {
            toast.remove();
        }, 300);
    },

    // Custom Modal Confirm Dialog
    confirm(message, title = "Confirm Action", confirmText = "Delete", cancelText = "Cancel") {
        return new Promise((resolve) => {
            const modal = document.getElementById('confirm-modal');
            const titleEl = document.getElementById('confirm-title');
            const messageEl = document.getElementById('confirm-message');
            const cancelBtn = document.getElementById('confirm-cancel-btn');
            const okBtn = document.getElementById('confirm-ok-btn');

            if (!modal) {
                // Fallback to native if DOM is missing
                resolve(window.confirm(message));
                return;
            }

            titleEl.textContent = title;
            messageEl.textContent = message;
            if (cancelBtn) cancelBtn.textContent = cancelText;
            if (okBtn) okBtn.textContent = confirmText;

            const cleanup = () => {
                modal.classList.remove('active');
                cancelBtn.removeEventListener('click', onCancel);
                okBtn.removeEventListener('click', onOk);
            };

            const onCancel = () => {
                cleanup();
                resolve(false);
            };

            const onOk = () => {
                cleanup();
                resolve(true);
            };

            cancelBtn.addEventListener('click', onCancel);
            okBtn.addEventListener('click', onOk);

            modal.classList.add('active');
        });
    }
};

const HistoryManager = {
    renderSkeletons(container) {
        container.innerHTML = '';
        for (let i = 0; i < 5; i++) {
            const el = document.createElement('div');
            el.className = 'p-2.5 rounded-lg flex flex-col gap-1.5 opacity-65 mb-1';
            el.innerHTML = `
                <div class="shimmer-bar h-3 w-11/12"></div>
                <div class="shimmer-bar h-2 w-7/12 opacity-50"></div>
            `;
            container.appendChild(el);
        }
    },

    // Derive the device prefix from the current session to filter sessions
    // belonging to this device only. Sessions from other devices are never shown.
    getDevicePrefix() {
        const sid = App.sessionId;
        if (sid && sid.startsWith('dev_')) {
            // Format: dev_{device_id}_session_{uuid}
            // Extract: dev_{device_id}
            const parts = sid.split('_');
            if (parts.length >= 3) {
                return 'dev_' + parts[1];
            }
        }
        return null;
    },

    async loadSessions(showSkeletons = true) {
        const container = document.getElementById('sidebar-history-container');
        if (!container) return;

        // Show skeletons immediately if requested
        if (showSkeletons) {
            this.renderSkeletons(container);
        }

        try {
            const res = await fetch(`${App.apiBase}/api/query/sessions`);
            const data = await res.json();

            if (data.status === 'success' && data.sessions.length > 0) {
                // Filter sessions to only show those belonging to THIS device
                const devicePrefix = this.getDevicePrefix();
                let filteredSessions = data.sessions;

                if (devicePrefix) {
                    filteredSessions = data.sessions.filter(session =>
                        session.session_id && session.session_id.startsWith(devicePrefix)
                    );
                } else {
                    // Old sessions without device prefix — only show if they match
                    // the current session (which means they were created before this update)
                    filteredSessions = data.sessions.filter(session =>
                        session.session_id === App.sessionId
                    );
                }

                if (filteredSessions.length === 0) {
                    container.innerHTML = `
                        <div class="px-2 py-4 text-center text-gray-500 text-xs italic select-none">
                            No previous chats
                        </div>
                    `;
                    return;
                }

                container.innerHTML = '';

                filteredSessions.forEach(session => {
                    const isActive = App.sessionId === session.session_id;
                    const el = document.createElement('div');
                    el.className = `sidebar-history-item ${isActive ? 'active' : ''}`;
                    el.dataset.id = session.session_id;

                    el.innerHTML = `
                        <span class="sidebar-history-item-text">${session.preview}</span>
                        <button class="sidebar-history-delete-btn" title="Delete conversation" aria-label="Delete conversation">
                            <span class="material-symbols-outlined text-[15px]">delete</span>
                        </button>
                    `;

                    // Click to load
                    el.onclick = (e) => {
                        // If delete button clicked, don't trigger load
                        if (e.target.closest('.sidebar-history-delete-btn')) return;
                        this.loadSession(session.session_id);
                    };

                    // Delete action
                    const deleteBtn = el.querySelector('.sidebar-history-delete-btn');
                    deleteBtn.onclick = (e) => {
                        e.stopPropagation();
                        this.deleteSession(session.session_id, el);
                    };

                    container.appendChild(el);
                });
            } else {
                container.innerHTML = `
                    <div class="px-2 py-4 text-center text-gray-500 text-xs italic select-none">
                        No previous chats
                    </div>
                `;
            }
        } catch (e) {
            console.error("Failed to load sessions:", e);
            container.innerHTML = `
                <div class="px-2 py-4 text-center text-red-500/50 text-xs italic select-none">
                    Error loading chats
                </div>
            `;
        }
    },

    async deleteSession(sessionId, element) {
        const isConfirmed = await App.confirm(
            "Delete this conversation log permanently? Uploaded files will be kept.",
            "Delete Chat",
            "Delete",
            "Cancel"
        );
        if (!isConfirmed) return;

        // ── Optimistic Update ──
        // Cache DOM state for rollback
        const parent = element.parentNode;
        const nextSibling = element.nextSibling;
        const wasActive = App.sessionId === sessionId;

        // Trigger slide-out and hide immediately
        element.style.transition = "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)";
        element.style.opacity = "0";
        element.style.transform = "translateX(-20px)";
        element.style.height = "0px";
        element.style.padding = "0px";
        element.style.margin = "0px";

        const removeTimeout = setTimeout(() => {
            element.remove();
            if (parent && parent.children.length === 0) {
                parent.innerHTML = `
                    <div class="px-2 py-4 text-center text-gray-500 text-xs italic select-none">
                        No previous chats
                    </div>
                `;
            }
        }, 250);

        if (wasActive) {
            App.startNewChat();
        }

        // Removed optimistic toast per user request

        try {
            const res = await fetch(`${App.apiBase}/api/query/sessions/${sessionId}`, {
                method: 'DELETE'
            });
            const data = await res.json();

            if (data.status !== 'success') {
                throw new Error("Failed to delete conversation on server");
            }
        } catch (e) {
            console.error("Failed to delete session, rolling back:", e);
            clearTimeout(removeTimeout);

            // Restore visual layout
            element.style.transform = "none";
            element.style.opacity = "1";
            element.style.height = "";
            element.style.padding = "";
            element.style.margin = "";

            if (!element.parentNode && parent) {
                if (parent.innerHTML.includes("No previous chats")) {
                    parent.innerHTML = '';
                }
                if (nextSibling) {
                    parent.insertBefore(element, nextSibling);
                } else {
                    parent.appendChild(element);
                }
            }
            App.showToast("Failed to delete conversation", "error");
        }
    },

    async loadSession(sessionId) {
        if (App.sessionId === sessionId) return;

        App.sessionId = sessionId;
        localStorage.setItem('finsight_session_id', sessionId);
        App.updateSessionHeader();

        // Update active class immediately in sidebar for high-end feel
        const items = document.querySelectorAll('.sidebar-history-item');
        items.forEach(item => {
            if (item.dataset.id === sessionId) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });

        // 1. Fetch History
        if (typeof Chat !== 'undefined') {
            Chat.resetChatUI(false);
            await Chat.loadChatHistory();
        }

        // 2. Fetch Documents
        if (typeof Sidebar !== 'undefined') {
            await Sidebar.loadDocuments();
        }
    }
};

// Initialize on page load
window.addEventListener('DOMContentLoaded', () => App.init());
