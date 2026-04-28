#!/bin/bash
# ── Chatbot API — Quick Start Script ──────────────────────────────────────────
# Usage: ./start.sh [model]
# Example: ./start.sh qwen2.5:1.5b

set -e

MODEL="${1:-qwen2.5:1.5b}"
BOLD="\033[1m"
GREEN="\033[32m"
CYAN="\033[36m"
RESET="\033[0m"

echo -e "${BOLD}${CYAN}🚀 Starting Chatbot API with local Llama...${RESET}"
echo ""

# 1. Build and start containers
echo -e "${GREEN}▸ Building and starting containers...${RESET}"
docker compose up -d --build

# 2. Wait for Ollama to be ready
echo -e "${GREEN}▸ Waiting for Ollama to be ready...${RESET}"
until docker exec chatbot-ollama ollama list > /dev/null 2>&1; do
  sleep 2
  echo "  ⏳ Ollama starting up..."
done
echo -e "  ✅ Ollama is ready!"

# 3. Pull the model if not already present
echo -e "${GREEN}▸ Ensuring model '${MODEL}' is available...${RESET}"
docker exec chatbot-ollama ollama pull "$MODEL"
echo -e "  ✅ Model ready!"

# 4. Show status
echo ""
echo -e "${BOLD}${CYAN}════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}  ✅ Chatbot API is running!${RESET}"
echo -e ""
echo -e "  🌐 API:    ${BOLD}http://localhost:3000${RESET}"
echo -e "  🤖 Model:  ${BOLD}${MODEL}${RESET}"
echo -e "  🔗 Ollama: ${BOLD}http://localhost:11434${RESET}"
echo -e "  🧠 Provider: ${BOLD}${LLM_PROVIDER:-ollama}${RESET}"
echo -e ""
echo -e "  Test it:"
echo -e "  ${CYAN}curl -X POST http://localhost:3000/api/chat \\${RESET}"
echo -e "  ${CYAN}  -H 'Content-Type: application/json' \\${RESET}"
echo -e "  ${CYAN}  -d '{\"message\": \"hi, what do you sell?\"}'${RESET}"
echo -e "${BOLD}${CYAN}════════════════════════════════════════════════${RESET}"
echo ""
echo -e "  Tip: If CPU inference is too slow, set ${BOLD}LLM_PROVIDER=groq${RESET} in ${BOLD}.env${RESET} and restart Docker."
echo ""

# 5. Finished
echo -e "${GREEN}▸ Containers are running in the background.${RESET}"
