/* chat.js - SSE Stream Handler and Message Rendering */

const Chat = {
    isStreaming: false,

    init() {
        const form = document.getElementById('chat-form');
        const input = document.getElementById('chat-input');
        const newChatBtn = document.getElementById('new-chat-btn');

        if (!form) return;

        // Auto-resize textarea on input
        input.style.overflowY = 'hidden';
        input.addEventListener('input', () => {
            input.style.height = 'auto';
            input.style.height = input.scrollHeight + 'px';
            if (input.scrollHeight > 160) {
                input.style.height = '160px';
                input.style.overflowY = 'auto';
            } else {
                input.style.overflowY = 'hidden';
            }
        });

        // Enter submits, Shift+Enter adds new line
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                form.requestSubmit();
            }
        });

        form.onsubmit = (e) => {
            e.preventDefault();
            const q = input.value.trim();
            if (q) {
                this.handleUserQuery(q);
                input.value = '';
                input.style.height = 'auto';
            }
        };

        // New Chat logic is handled by App.startNewChat() in index.html onclick

        // Fetch history turns from database
        this.loadChatHistory();
    },

    // Fetches turns from database and renders them
    async loadChatHistory() {
        const spinner = document.getElementById('initial-loading-spinner');
        const welcome = document.getElementById('welcome-empty-state');
        const messagesFlow = document.getElementById('chat-messages-flow');

        // Show spinner on start
        if (spinner) {
            spinner.classList.remove('hidden');
            spinner.style.opacity = '1';
        }

        try {
            const res = await fetch(`${App.apiBase}/api/query/history?session_id=${App.sessionId}`);
            if (!res.ok) throw new Error("Failed to load chat history");
            const data = await res.json();

            // Hide spinner
            if (spinner) {
                spinner.style.opacity = '0';
                setTimeout(() => spinner.classList.add('hidden'), 300);
            }

            if (data.history && data.history.length > 0) {
                // Hide welcome state
                if (welcome) {
                    welcome.classList.add('hidden');
                    welcome.classList.remove('flex');
                }
                // Show chat flow
                messagesFlow.classList.remove('hidden');

                // Render each turn in correct chronological order
                data.history.forEach((turn, index) => {
                    // Waterfall cascade delay
                    const cascadeDelay = (index * 120) + 100;
                    if (turn.role === 'user') {
                        this.appendUserMessage(turn.content, cascadeDelay);
                    } else if (turn.role === 'assistant') {
                        const aiCard = this.appendAIMessageCard(cascadeDelay);
                        const textNode = aiCard.querySelector('.ai-text-target');
                        textNode.innerHTML = this.formatAnswerHTML(turn.content);
                    }
                });
                this.scrollToBottom();
            } else {
                // Show welcome state if no history
                if (welcome) {
                    welcome.classList.remove('hidden');
                    welcome.classList.add('flex');
                }
            }
        } catch (err) {
            console.error("Error loading chat history:", err);
            // Hide spinner
            if (spinner) {
                spinner.style.opacity = '0';
                setTimeout(() => spinner.classList.add('hidden'), 300);
            }
            if (welcome) {
                welcome.classList.remove('hidden');
                welcome.classList.add('flex');
            }
        }
    },

    // Reset Chat UI back to Welcome empty state
    resetChatUI(showWelcome = true) {
        const msgFlow = document.getElementById('chat-messages-flow');
        const welcome = document.getElementById('welcome-empty-state');
        if (msgFlow) {
            msgFlow.innerHTML = '';
            msgFlow.classList.add('hidden');
        }
        if (welcome) {
            if (showWelcome) {
                welcome.classList.remove('hidden');
                welcome.classList.add('flex');
            } else {
                welcome.classList.add('hidden');
                welcome.classList.remove('flex');
            }
        }
    },

    // Clears conversation history — creates a fresh session
    clearHistory() {
        localStorage.removeItem('finsight_session_id');
        const deviceId = typeof getDeviceId === 'function' ? getDeviceId() : 'unknown';
        App.sessionId = (() => {
            let sid;
            if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
                sid = 'dev_' + deviceId + '_session_' + crypto.randomUUID().replace(/-/g, '');
            } else {
                sid = 'dev_' + deviceId + '_session_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
            }
            localStorage.setItem('finsight_session_id', sid);
            return sid;
        })();

        const sessionTag = document.getElementById('session-tag');
        if (sessionTag) {
            sessionTag.textContent = `SESSION: ${App.sessionId.substring(8, 16)}...`;
        }

        this.resetChatUI();
        App.showToast("Conversation memory cleared. New session started.", "success");
    },

    // Handle incoming User Questions
    async handleUserQuery(question) {
        if (this.isStreaming) return;

        // Collapse empty state view
        const welcomeState = document.getElementById('welcome-empty-state');
        if (welcomeState) {
            welcomeState.classList.add('hidden');
            welcomeState.classList.remove('flex');
        }
        const messagesFlow = document.getElementById('chat-messages-flow');
        messagesFlow.classList.remove('hidden');

        // Append User Turn Element
        this.appendUserMessage(question);

        // Append AI thinking container (shimmer loader)
        const loader = this.appendAILoader();
        this.setComposerStreamingState(true);
        this.scrollToBottom();

        try {
            // Wait for any pending document uploads to finish indexing with a safety timeout
            if (App.uploadPromises && App.uploadPromises.length > 0) {
                try {
                    await Promise.race([
                        Promise.all(App.uploadPromises),
                        new Promise(resolve => setTimeout(resolve, 15000))
                    ]);
                } catch (e) {
                    console.warn("Upload promise wait warning:", e);
                }
            }

            const requestPayload = {
                question: question,
                session_id: App.sessionId,
                top_k: App.settings.topK,
                alpha: App.settings.alpha
            };

            const headers = { 'Content-Type': 'application/json' };
            const voyageKey = localStorage.getItem('finsight_voyage_key');
            const groqKey = localStorage.getItem('finsight_llm_key');
            if (voyageKey) headers['X-Voyage-Key'] = voyageKey;
            if (groqKey) headers['X-Groq-Key'] = groqKey;

            const response = await fetch(`${App.apiBase}/api/query`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(requestPayload)
            });

            if (!response.ok) {
                const err = new Error(`Query failed with status ${response.status}`);
                err.status = response.status;
                throw err;
            }

            let hasInitializedResponse = false;
            let aiCard = null;
            let textNode = null;

            // Read SSE chunks with explicit reader lifecycle management
            let reader = null;
            let rawAnswer = '';

            try {
                reader = response.body.getReader();
                const decoder = new TextDecoder('utf-8');
                let buffer = '';

                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop();

                    for (const line of lines) {
                        const cleaned = line.trim();
                        if (!cleaned || cleaned === 'data: [DONE]') continue;

                        if (cleaned.startsWith('data: ')) {
                            try {
                                const parsed = JSON.parse(cleaned.substring(6));

                                if (parsed.type === 'token') {
                                    // Initialize the visual response card on first token
                                    if (!hasInitializedResponse) {
                                        if (loader && loader.parentNode) loader.remove();
                                        aiCard = this.appendAIMessageCard();
                                        textNode = aiCard.querySelector('.ai-text-target');
                                        hasInitializedResponse = true;
                                    }

                                    rawAnswer += parsed.data;
                                    textNode.innerHTML = this.formatAnswerHTML(rawAnswer) + '<span class="streaming-cursor"></span>';
                                    this.scrollToBottom();
                                }
                            } catch (err) {
                                console.error("SSE line parse error:", err, cleaned);
                            }
                        }
                    }
                }
            } finally {
                if (reader) {
                    try {
                        reader.cancel().catch(() => {});
                        reader.releaseLock();
                    } catch (e) {}
                }
            }

            if (textNode) {
                const cursor = textNode.querySelector('.streaming-cursor');
                if (cursor) cursor.remove();
                textNode.innerHTML = this.formatAnswerHTML(rawAnswer);
            } else if (!hasInitializedResponse && loader && loader.parentNode) {
                loader.remove();
            }

        } catch (err) {
            console.error("[FinSight AI Engine] Query streaming error:", err);
            if (loader && loader.parentNode) {
                loader.remove();
            }
            const friendlyMsg = this.mapTechnicalErrorToUserMessage(err.message || String(err), err.status);
            this.appendErrorCard(friendlyMsg);
        } finally {
            // Centralized Recovery Path: Ensure input state & composer controls ALWAYS recover exactly once
            this.setComposerStreamingState(false);
            
            // Clean up any lingering streaming cursors if stream was aborted mid-flight
            const remainingCursors = document.querySelectorAll('.streaming-cursor');
            remainingCursors.forEach(c => c.remove());

            this.scrollToBottom();
            if (typeof HistoryManager !== 'undefined') {
                HistoryManager.loadSessions(false);
            }
        }
    },

    /**
     * Centralized Error Mapper: Translates HTTP status codes, network errors,
     * and exceptions into human-readable, professional user messages.
     */
    mapTechnicalErrorToUserMessage(rawError, status = null) {
        if (status === 429) {
            return "Request limit reached. Please wait a few seconds before asking another question.";
        }
        if (status === 401 || status === 403) {
            return "Authentication error. Please check your API key configuration in Settings.";
        }
        if (status === 500) {
            return "The AI assistant is temporarily unavailable. Please retry in a few moments.";
        }

        const errStr = String(rawError).toLowerCase();

        if (errStr.includes('abort') || errStr.includes('cancelled')) {
            return "Request was cancelled.";
        }
        if (errStr.includes('429') || errStr.includes('rate limit')) {
            return "Request limit reached. Please wait a few seconds before asking another question.";
        }
        if (errStr.includes('401') || errStr.includes('403') || errStr.includes('api key')) {
            return "Authentication error. Please check your API key configuration in Settings.";
        }
        if (errStr.includes('500') || errStr.includes('status 500') || errStr.includes('internal server error')) {
            return "The AI assistant is temporarily unavailable. Please retry in a few moments.";
        }
        if (errStr.includes('network') || errStr.includes('failed to fetch') || errStr.includes('offline')) {
            return "Unable to reach the assistant server. Please check your network connection.";
        }
        if (errStr.includes('timeout')) {
            return "The request timed out. Please try asking a shorter question or re-uploading the document.";
        }

        return "An unexpected issue occurred while generating your answer. Please try asking your question again.";
    },

    appendUserMessage(text, cascadeDelay = 0) {
        const flow = document.getElementById('chat-messages-flow');
        const turn = document.createElement('div');
        turn.className = "flex justify-end w-full animate-fade-rise";
        if (cascadeDelay > 0) turn.style.animationDelay = `${cascadeDelay}ms`;
        turn.innerHTML = `
            <div class="message-user-card">${text}</div>
        `;
        flow.appendChild(turn);
        return turn;
    },

    appendAILoader() {
        const flow = document.getElementById('chat-messages-flow');
        const turn = document.createElement('div');
        turn.className = "flex justify-start w-full animate-fade-rise";
        turn.innerHTML = `
            <div class="message-ai-response font-body w-full max-w-2xl py-2 flex flex-col gap-3">
                <div class="shimmer-bar h-4 w-full"></div>
                <div class="shimmer-bar h-4 w-5/6"></div>
                <div class="shimmer-bar h-4 w-4/6"></div>
            </div>
        `;
        flow.appendChild(turn);
        return turn;
    },

    appendAIMessageCard(cascadeDelay = 0) {
        const flow = document.getElementById('chat-messages-flow');
        const turn = document.createElement('div');
        turn.className = "flex justify-start w-full animate-fade-rise";
        if (cascadeDelay > 0) turn.style.animationDelay = `${cascadeDelay}ms`;
        turn.innerHTML = `
            <div class="message-ai-response font-body text-base leading-relaxed select-text selection:bg-amber/25">
                <div class="ai-text-target text-left prose prose-invert max-w-none"></div>
            </div>
        `;
        flow.appendChild(turn);
        return turn;
    },

    appendErrorCard(message) {
        const flow = document.getElementById('chat-messages-flow');
        const turn = document.createElement('div');
        turn.className = "flex justify-start w-full animate-fade-rise";
        turn.innerHTML = `
            <div class="message-ai-response border-amber/20 bg-amber/5 rounded-2xl px-5 py-4 max-w-2xl border">
                <div class="flex items-center gap-2 text-amber text-sm font-semibold mb-1">
                    <span class="material-symbols-outlined text-[18px]">info</span>
                    <span>Assistant Notice</span>
                </div>
                <p class="text-xs text-taupe leading-relaxed font-body">${message}</p>
            </div>
        `;
        flow.appendChild(turn);
    },

    // Convert raw markdown text to sanitized HTML
    formatAnswerHTML(text) {
        // 1. Parse Markdown
        let html = marked.parse(text, { breaks: true });

        // 2. Sanitize HTML to prevent XSS
        html = DOMPurify.sanitize(html);

        return html;
    },

    setComposerStreamingState(active) {
        this.isStreaming = active;
        const sendBtn = document.getElementById('send-btn');
        const icon = document.getElementById('send-icon');
        const input = document.getElementById('chat-input');

        if (active) {
            input.disabled = true;
            if (sendBtn) {
                sendBtn.disabled = true;
                sendBtn.className = "w-9 h-9 rounded-full bg-copper text-void flex items-center justify-center cursor-not-allowed opacity-80 animate-pulse";
            }
            input.placeholder = "FinSight AI is retrieving information and formulating answer...";
            if (icon) {
                icon.className = 'material-symbols-outlined animate-spin text-[20px]';
                icon.textContent = 'sync';
            }
        } else {
            input.disabled = false;
            if (sendBtn) {
                sendBtn.disabled = false;
                sendBtn.className = "w-9 h-9 rounded-full bg-[#D4AF37] text-white flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-md cursor-pointer";
            }
            input.placeholder = "Ask me anything...";
            if (icon) {
                icon.className = 'material-symbols-outlined text-[20px]';
                icon.textContent = 'arrow_upward';
            }
            // Only auto-focus on desktop (>=1024px) to prevent unwanted mobile software keyboard popups
            if (window.innerWidth >= 1024) {
                input.focus();
            }
        }
    },

    scrollToBottom() {
        const container = document.getElementById('chat-thread-container');
        const composer = document.querySelector('.composer-container');
        if (container && composer) {
            // Calculate padding bottom based on the composer's actual position
            // relative to the visual viewport bottom edge.
            // This ensures the last message is always visible above the composer
            // regardless of keyboard state or bottom chrome.
            const composerHeight = composer.offsetHeight || 56;

            // On mobile (<1024px): read the dynamic --composer-bottom-offset
            // which is the exact CSS `bottom` value set by adjustComposerPosition().
            // On desktop (>=1024px): use the standard 24px + safe-area fallback.
            let composerBottomOffset;
            if (window.innerWidth < 1024) {
                composerBottomOffset = parseInt(
                    getComputedStyle(document.documentElement)
                        .getPropertyValue('--composer-bottom-offset')
                ) || 24;
            } else {
                // Desktop: use the CSS calc(24px + env(safe-area-inset-bottom))
                // We approximate this as ~40px for padding calculation.
                composerBottomOffset = 40;
            }

            // The total space below the chat messages = composer height + bottom offset + 16px extra
            const dynamicPadding = composerHeight + composerBottomOffset + 16;
            container.style.paddingBottom = `${dynamicPadding}px`;
            container.scrollTop = container.scrollHeight;
        } else if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }
};

window.addEventListener('DOMContentLoaded', () => Chat.init());
