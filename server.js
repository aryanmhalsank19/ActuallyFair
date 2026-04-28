require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');

const db = require('./db');
const { buildSystemPrompt } = require('./prompt');
const {
  findProductByName,
  detectBodySignals,
  detectActivityNeeds,
  getRelevantProducts,
  catalog,
} = require('./catalog');

// ─── App setup ───────────────────────────────────────────────────────────────

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10kb' }));

// Rate limiting — 60 requests per minute per IP
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many requests. Please slow down.' },
});
app.use('/api/', limiter);

// ─── LLM provider configuration ─────────────────────────────────────────────

const LLM_PROVIDER = (process.env.LLM_PROVIDER || 'ollama').toLowerCase();
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:1.5b';
const OLLAMA_MAX_TOKENS = parseInt(process.env.OLLAMA_MAX_TOKENS || '384', 10);

// Groq client — only initialize if using Groq provider
let groq = null;
if (LLM_PROVIDER === 'groq') {
  const Groq = require('groq-sdk');
  groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
}

// ─── LLM abstraction ────────────────────────────────────────────────────────

/**
 * Call the configured LLM provider and return the assistant's response text.
 * Supports both Ollama (local) and Groq (cloud) backends.
 */
async function callLLM(messages, { maxTokens, temperature = 0.7 } = {}) {
  if (LLM_PROVIDER === 'ollama') {
    return callOllama(messages, { maxTokens: maxTokens ?? OLLAMA_MAX_TOKENS, temperature });
  } else if (LLM_PROVIDER === 'groq') {
    return callGroq(messages, { maxTokens: maxTokens ?? 1024, temperature });
  } else {
    throw new Error(`Unknown LLM_PROVIDER: "${LLM_PROVIDER}". Use "ollama" or "groq".`);
  }
}

/**
 * Call Ollama's local REST API (OpenAI-compatible chat endpoint)
 */
async function callOllama(messages, { maxTokens, temperature }) {
  const url = `${OLLAMA_HOST}/api/chat`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages,
      stream: false,
      options: {
        num_predict: maxTokens,
        temperature,
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => 'Unknown error');
    const err = new Error(`Ollama API error (${response.status}): ${errText}`);
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  return data.message?.content || '';
}

/**
 * Call Groq's cloud API using the groq-sdk
 */
async function callGroq(messages, { maxTokens, temperature }) {
  let groqModel = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  if (groqModel === 'llama3-70b-8192') groqModel = 'llama-3.3-70b-versatile';

  const completion = await groq.chat.completions.create({
    model: groqModel,
    messages,
    max_tokens: maxTokens,
    temperature,
  });

  return completion.choices[0]?.message?.content || '';
}

// ─── Input validation ─────────────────────────────────────────────────────────

function validateChatInput(body) {
  const errors = [];

  if (!body.message || typeof body.message !== 'string') {
    errors.push('message is required and must be a string');
  } else if (body.message.trim().length === 0) {
    errors.push('message cannot be empty');
  } else if (body.message.length > 1000) {
    errors.push('message must be under 1000 characters');
  }

  if (body.session_id && typeof body.session_id !== 'string') {
    errors.push('session_id must be a string');
  }

  if (body.session_id && body.session_id.length > 100) {
    errors.push('session_id is too long');
  }

  return errors;
}

// ─── Parse missing product signal from LLM response ──────────────────────────

function parseMissingProductSignal(text) {
  const match = text.match(/<MISSING_PRODUCT>(\{.*?\})<\/MISSING_PRODUCT>/s);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function stripMissingProductTag(text) {
  return text.replace(/<MISSING_PRODUCT>.*?<\/MISSING_PRODUCT>/s, '').trim();
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/chat
 * Main chatbot endpoint
 */
app.post('/api/chat', async (req, res) => {
  // 1. Validate input
  const errors = validateChatInput(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  const userMessage = req.body.message.trim();
  const sessionId = req.body.session_id || uuidv4();

  try {
    // 2. Initialize DB and session
    await db.getDb();
    db.upsertSession(sessionId);

    // 3. Save user message
    db.saveMessage(uuidv4(), sessionId, 'user', userMessage);

    // 4. Build context-aware messages for LLM
    const history = db.getHistory(sessionId, 20);
    // history already includes the message we just saved, so we use it directly
    const messages = history; // roles: user/assistant

    // 5. Call LLM (Ollama or Groq, depending on LLM_PROVIDER)
    const historyText = messages.filter(m => m.role === 'user').map(m => m.content).join(' ');
    const systemPrompt = buildSystemPrompt(historyText);

    let assistantResponse;
    try {
      assistantResponse = await callLLM([
        { role: 'system', content: systemPrompt },
        ...messages,
      ]);
    } catch (llmError) {
      console.error(`LLM error (${LLM_PROVIDER}):`, llmError);
      if (llmError.status === 401) {
        return res.status(500).json({ error: 'LLM authentication failed. Check your API key.' });
      }
      if (llmError.status === 429) {
        return res.status(429).json({ error: 'LLM rate limit reached. Try again in a moment.' });
      }
      return res.status(500).json({ error: 'Failed to get response from AI. Please try again.' });
    }

    // 6. Check for and handle missing product signal
    const missingSignal = parseMissingProductSignal(assistantResponse);
    if (missingSignal) {
      // Find relevant alternatives for the missing product
      const alternatives = getRelevantProducts(
        `${missingSignal.productQuery} ${missingSignal.userNeed || ''}`,
        3
      ).map((p) => p.title);

      db.saveMissingProductRequest({
        id: uuidv4(),
        sessionId,
        productQuery: missingSignal.productQuery,
        userNeed: missingSignal.userNeed || '',
        suggestedAlternatives: alternatives,
      });

      // Strip the tag from the final response
      assistantResponse = stripMissingProductTag(assistantResponse);
    }

    // 7. Save assistant response
    db.saveMessage(uuidv4(), sessionId, 'assistant', assistantResponse);

    // 8. Return response
    return res.json({
      session_id: sessionId,
      message: assistantResponse,
      missing_product_logged: missingSignal ? true : undefined,
    });
  } catch (err) {
    console.error('Chat error:', err);
    return res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
});

/**
 * POST /api/sessions
 * Create a new session explicitly (optional — chat auto-creates one)
 */
app.post('/api/sessions', async (req, res) => {
  try {
    await db.getDb();
    const sessionId = uuidv4();
    db.upsertSession(sessionId);
    return res.status(201).json({ session_id: sessionId });
  } catch (err) {
    console.error('Session creation error:', err);
    return res.status(500).json({ error: 'Failed to create session.' });
  }
});

/**
 * DELETE /api/sessions/:sessionId
 * Clear a session's history
 */
app.delete('/api/sessions/:sessionId', async (req, res) => {
  try {
    await db.getDb();
    const { sessionId } = req.params;
    if (!sessionId || sessionId.length > 100) {
      return res.status(400).json({ error: 'Invalid session ID.' });
    }
    db.clearHistory(sessionId);
    return res.json({ message: 'Session cleared.' });
  } catch (err) {
    console.error('Session clear error:', err);
    return res.status(500).json({ error: 'Failed to clear session.' });
  }
});

/**
 * GET /api/sessions/:sessionId/history
 * Get conversation history for a session
 */
app.get('/api/sessions/:sessionId/history', async (req, res) => {
  try {
    await db.getDb();
    const { sessionId } = req.params;
    if (!sessionId || sessionId.length > 100) {
      return res.status(400).json({ error: 'Invalid session ID.' });
    }
    const history = db.getHistory(sessionId, 50);
    return res.json({ session_id: sessionId, messages: history });
  } catch (err) {
    console.error('History error:', err);
    return res.status(500).json({ error: 'Failed to fetch history.' });
  }
});

/**
 * GET /api/products
 * Browse the catalog (with optional search)
 */
app.get('/api/products', async (req, res) => {
  try {
    const { search, limit = 20 } = req.query;
    const lim = Math.min(parseInt(limit) || 20, 100);

    let results = catalog;

    if (search && typeof search === 'string') {
      const q = search.toLowerCase();
      results = catalog.filter(
        (p) =>
          p.searchText.includes(q) ||
          p.title.toLowerCase().includes(q)
      );
    }

    return res.json({
      total: results.length,
      products: results.slice(0, lim).map((p) => ({
        id: p.id,
        title: p.title,
        price: p.priceDisplay,
        markup: p.markup,
        material: p.material,
        sizes: p.sizes,
        colors: p.colors,
        keywords: p.keywords,
        featuredImage: p.featuredImage,
        description: p.description.substring(0, 200),
      })),
    });
  } catch (err) {
    console.error('Products error:', err);
    return res.status(500).json({ error: 'Failed to fetch products.' });
  }
});

/**
 * GET /api/admin/missing-requests
 * View logged missing product requests (admin use)
 */
app.get('/api/admin/missing-requests', async (req, res) => {
  // Basic token check — set ADMIN_TOKEN in .env for production use
  const token = req.headers['x-admin-token'];
  if (process.env.ADMIN_TOKEN && token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }
  try {
    await db.getDb();
    const requests = db.getMissingProductRequests(100);
    return res.json({ total: requests.length, requests });
  } catch (err) {
    console.error('Missing requests error:', err);
    return res.status(500).json({ error: 'Failed to fetch requests.' });
  }
});

/**
 * GET /api/health
 */
app.get('/api/health', (req, res) => {
  const providerInfo = LLM_PROVIDER === 'ollama'
    ? { provider: 'ollama', model: OLLAMA_MODEL, host: OLLAMA_HOST }
    : { provider: 'groq', model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile' };

  res.json({ status: 'ok', catalog_size: catalog.length, llm: providerInfo });
});

// ─── 404 handler ─────────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found.' });
});

// ─── Error handler ────────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error.' });
});

// ─── Start ────────────────────────────────────────────────────────────────────

async function start() {
  await db.getDb(); // Initialize DB on startup
  app.listen(PORT, () => {
    console.log(`✅ Chatbot API running on http://localhost:${PORT}`);
    console.log(`📦 Catalog loaded: ${catalog.length} available products`);

    if (LLM_PROVIDER === 'ollama') {
      console.log(`🤖 LLM Provider: Ollama (local)`);
      console.log(`   Model: ${OLLAMA_MODEL}`);
      console.log(`   Host:  ${OLLAMA_HOST}`);
    } else {
      let groqModel = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
      if (groqModel === 'llama3-70b-8192') groqModel = 'llama-3.3-70b-versatile';
      console.log(`🤖 LLM Provider: Groq (cloud)`);
      console.log(`   Model: ${groqModel}`);
    }
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
