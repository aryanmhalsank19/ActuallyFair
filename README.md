# Actually Fair Chatbot API

REST API for Actually Fair shopping chatbot.

## Tech Stack

- Node.js 18+
- Express
- `sql.js` with SQLite file persistence
- Ollama for LLM inference
- Docker and Docker Compose for local containerized runs

## Run Locally

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from the example:

```bash
cp .env.example .env
```

3. Start the server:

```bash
npm start
```

For development mode:

```bash
npm run dev
```

The API runs at:

```bash
http://localhost:3000
```

## Run With Docker

Start the stack:

```bash
docker compose up -d --build
```

Check health:

```bash
curl http://localhost:3000/api/health
```

Send a chat request:

```bash
./test_chat.sh "What kind of yoga pants do you have?"
```

## Data

The live SQLite database is stored at:

```bash
sqlite3 data/chatbot.sqlite
```
