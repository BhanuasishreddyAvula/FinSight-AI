<div align="center">
  <img src="frontend/FinSight AI.png" alt="FinSight AI Logo" width="120" height="120">
  
  # FinSight AI 🚀
  
  **An Enterprise-Grade, Production-Ready Retrieval-Augmented Generation (RAG) Platform**
  
  *Built to solve the industry-wide problems of LLM hallucination and context fragmentation, FinSight AI allows analysts to upload raw financial documents and instantly interact with them in real-time, grounded entirely in the uploaded sources.*
</div>

---

## 🌟 Why FinSight AI?

Most RAG (Retrieval-Augmented Generation) tutorials build "toy" applications that break when fed real-world, complex financial documents like 10-Ks or Earnings Call Transcripts. **FinSight AI is different.** 

I engineered this platform from the ground up to demonstrate deep, production-level architecture patterns used by top-tier tech companies.

### 🧠 The Architecture (How it works under the hood)

1. **Parent-Child Document Chunking (Context Expansion):** 
   - **The Problem:** Naive chunking destroys document context. If an LLM is only fed an isolated 300-token chunk, it often loses the overarching topic.
   - **The Solution:** FinSight utilizes `docling` to intelligently parse document structure. It splits documents into larger "Parent" chunks (logical sections) and smaller "Child" chunks (paragraphs). The vector database retrieves the highly-specific child chunks, but the backend maps them back to the full Parent section before feeding them to the LLM. **The LLM always gets complete, unfragmented context.**

2. **Advanced Hybrid Search:** 
   - Uses **Voyage AI** for state-of-the-art dense semantic embeddings to understand the *meaning* of the text.
   - Uses **Pinecone BM25 Sparse Vectors** to catch exact keyword matches (like specific ticker symbols, dates, or financial metrics). 
   - Both are combined and weighted dynamically in Pinecone.

3. **Cohere Reranking:** 
   - After initial retrieval and parent-expansion, candidate contexts are passed through the **Cohere Rerank API** to boost the absolute most relevant sections to the very top. This minimizes the noise in the LLM's context window and drastically reduces hallucinations.

4. **High-Performance Streaming (SSE):** 
   - Uses FastAPI's `StreamingResponse` to stream tokens token-by-token from the **Groq API** (Llama-3 70B) directly to the Vanilla JavaScript frontend. This achieves near-zero perceived latency, mimicking the speed of native ChatGPT.

5. **Optimistic & Premium UI (Desktop-First to Mobile-Perfect):**
   - Lightweight, framework-less **Vanilla JS** and **Tailwind CSS**.
   - Features a breathtaking Glassmorphic dark-theme UI with micro-animations, skeleton loading states, and dynamic Toast notifications.
   - Includes a **Live Diagnostics Panel** to visualize backend health, active session ID, and uploaded context vectors.

---

## 🛠️ Tech Stack

- **Backend:** Python, FastAPI, Pydantic, SlowAPI (Rate Limiting)
- **Database & Storage:** Supabase (PostgreSQL + Blob Storage), Pinecone (Vector DB)
- **AI / ML:** Voyage AI (Embeddings), Cohere (Reranking), Groq (Llama-3 70B inference)
- **Frontend:** HTML5, Tailwind CSS, Vanilla JS

---

## 🚀 Getting Started (Run it yourself!)

I built this project to be incredibly easy to run and test locally. 

### 1. Clone the repository
```bash
git clone https://github.com/your-username/finsight-ai.git
cd finsight-ai
```

### 2. Set up the environment
Create a virtual environment and install the verified dependencies:
```bash
python -m venv myenv

# On Windows:
myenv\Scripts\activate
# On Mac/Linux:
source myenv/bin/activate

# Install all dependencies
pip install -r requirements.txt
```

### 3. Configure Environment Variables
Copy the `.env.example` file to `.env` and fill in your API keys (Pinecone, Voyage, Groq, Supabase). *Note: The application has a BYOK (Bring Your Own Key) settings panel in the frontend as well!*
```bash
cp .env.example .env
```

### 4. Run the Application
Start the high-performance FastAPI server:
```bash
uvicorn main:app --reload --app-dir backend
```
The application will instantly be accessible at `http://127.0.0.1:8000`.

---

## 🛡️ Security & Reliability Features
- **Rate Limiting:** Protects expensive LLM and Embedding endpoints using in-memory token buckets (`slowapi`).
- **Context Exhaustion Protection:** Dynamically truncates long conversational histories to protect Groq's maximum context limits.
- **Transactional Rollbacks:** Automatically cleans up orphaned file blobs in Supabase Storage if the downstream Vector DB upsert fails, preventing memory leaks and ghost data.

---

<div align="center">
  <i>Built with passion and a relentless focus on user experience and system architecture.</i>
</div>
