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
        App.sessionId = (() => {
            let sid;
            if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
                sid = 'session_' + crypto.randomUUID().replace(/-/g, '');
            } else {
                sid = 'session_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
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
            // Wait for any pending document uploads to finish indexing in the backend
            // The skeleton shimmer loader is already on screen, so the user sees a seamless "thinking" state.
            if (App.uploadPromises && App.uploadPromises.length > 0) {
                await Promise.all(App.uploadPromises);
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

            if (!response.ok) throw new Error(`Query failed with status ${response.status}`);

            let hasInitializedResponse = false;
            let aiCard = null;
            let textNode = null;

            // Read SSE chunks
            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';
            let rawAnswer = '';

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
                                    loader.remove();
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

            if (textNode) {
                const cursor = textNode.querySelector('.streaming-cursor');
                if (cursor) cursor.remove();
                textNode.innerHTML = this.formatAnswerHTML(rawAnswer);
            } else if (!hasInitializedResponse) {
                loader.remove();
            }

        } catch (err) {
            console.error("Query streaming error:", err);
            loader.remove();
            this.appendErrorCard(err.message);
        } finally {
            this.setComposerStreamingState(false);
            this.scrollToBottom();
            if (typeof HistoryManager !== 'undefined') {
                HistoryManager.loadSessions(false);
            }
        }
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
            <div class="message-ai-response border-red-400/30 bg-red-400/5 rounded-2xl px-5 py-4">
                <p class="text-sm text-red-300 font-body">Retrieval pipeline or model connection failed:</p>
                <p class="text-xs text-red-200 mt-2 font-body bg-void/50 p-3 rounded border border-red-400/10">${message}</p>
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
            input.placeholder = "FinSight AI is retrieving information and formulating answer...";
            if (sendBtn) sendBtn.className = "w-11 h-11 rounded-full bg-copper text-void flex items-center justify-center cursor-not-allowed opacity-80 animate-pulse";
            if (icon) {
                icon.className = 'material-symbols-outlined animate-spin';
                icon.textContent = 'sync';
            }
        } else {
            input.disabled = false;
            input.placeholder = "Ask me anything about the sources...";
            if (sendBtn) sendBtn.className = "w-11 h-11 rounded-full bg-amber text-void flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-md cursor-pointer";
            if (icon) {
                icon.className = 'material-symbols-outlined';
                icon.textContent = 'arrow_upward';
            }
            input.focus();
        }
    },

    scrollToBottom() {
        const container = document.getElementById('chat-thread-container');
        const composer = document.querySelector('.composer-container');
        if (container && composer) {
            const composerHeight = composer.offsetHeight;
            const dynamicPadding = composerHeight + 64;
            container.style.paddingBottom = `${dynamicPadding}px`;
            requestAnimationFrame(() => {
                container.scrollTop = container.scrollHeight;
            });
        } else if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }
};

window.addEventListener('DOMContentLoaded', () => Chat.init());
