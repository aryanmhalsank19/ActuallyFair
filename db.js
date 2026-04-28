const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'chatbot.sqlite');

let db = null;

async function getDb() {
  if (db) return db;

  const SQL = await initSqlJs();

  // Ensure data directory exists
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Load existing DB or create new
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  initSchema();
  return db;
}

function initSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_conversations_session
    ON conversations(session_id, created_at)
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS missing_product_requests (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      product_query TEXT NOT NULL,
      user_need TEXT,
      suggested_alternatives TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      last_active INTEGER NOT NULL,
      message_count INTEGER DEFAULT 0
    )
  `);

  persist();
}

function persist() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// --- Session methods ---

function upsertSession(sessionId) {
  const now = Date.now();
  const existing = db.exec(`SELECT id FROM sessions WHERE id = '${sessionId}'`);
  if (existing.length === 0 || existing[0].values.length === 0) {
    db.run(
      `INSERT INTO sessions (id, created_at, last_active, message_count) VALUES (?, ?, ?, 0)`,
      [sessionId, now, now]
    );
  } else {
    db.run(
      `UPDATE sessions SET last_active = ?, message_count = message_count + 1 WHERE id = ?`,
      [now, sessionId]
    );
  }
  persist();
}

function sessionExists(sessionId) {
  const result = db.exec(`SELECT id FROM sessions WHERE id = ?`, [sessionId]);
  // sql.js exec doesn't support parameterized queries for SELECT well, use prepare
  const stmt = db.prepare(`SELECT id FROM sessions WHERE id = ?`);
  stmt.bind([sessionId]);
  const exists = stmt.step();
  stmt.free();
  return exists;
}

// --- Conversation methods ---

function saveMessage(id, sessionId, role, content) {
  const now = Date.now();
  db.run(
    `INSERT INTO conversations (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)`,
    [id, sessionId, role, content, now]
  );
  persist();
}

function getHistory(sessionId, limit = 20) {
  const stmt = db.prepare(
    `SELECT role, content FROM conversations
     WHERE session_id = ?
     ORDER BY created_at ASC
     LIMIT ?`
  );
  stmt.bind([sessionId, limit]);
  const messages = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    messages.push({ role: row.role, content: row.content });
  }
  stmt.free();
  return messages;
}

function clearHistory(sessionId) {
  db.run(`DELETE FROM conversations WHERE session_id = ?`, [sessionId]);
  db.run(`DELETE FROM sessions WHERE id = ?`, [sessionId]);
  persist();
}

// --- Missing product methods ---

function saveMissingProductRequest({ id, sessionId, productQuery, userNeed, suggestedAlternatives }) {
  const now = Date.now();
  db.run(
    `INSERT INTO missing_product_requests
     (id, session_id, product_query, user_need, suggested_alternatives, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, sessionId, productQuery, userNeed || '', JSON.stringify(suggestedAlternatives || []), now]
  );
  persist();
}

function getMissingProductRequests(limit = 50) {
  const stmt = db.prepare(
    `SELECT * FROM missing_product_requests ORDER BY created_at DESC LIMIT ?`
  );
  stmt.bind([limit]);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

module.exports = {
  getDb,
  upsertSession,
  sessionExists,
  saveMessage,
  getHistory,
  clearHistory,
  saveMissingProductRequest,
  getMissingProductRequests,
};
