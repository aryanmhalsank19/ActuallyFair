#!/bin/bash

set -u

MESSAGE="${1:-hi, I am looking for something to wear to yoga}"
API_URL="${API_URL:-http://localhost:3000}"
CHAT_URL="${API_URL}/api/chat"

echo "Testing Chatbot API with message: \"$MESSAGE\""
echo "--------------------------------------------------------"

RESPONSE_FILE="$(mktemp)"
HTTP_CODE="$(
  curl -sS \
    -o "$RESPONSE_FILE" \
    -w "%{http_code}" \
    -X POST "$CHAT_URL" \
    -H 'Content-Type: application/json' \
    -d "{\"message\":\"$MESSAGE\"}"
)"

if [ "$HTTP_CODE" -ge 400 ]; then
  echo "Chat request failed with HTTP $HTTP_CODE"
  cat "$RESPONSE_FILE"
  rm -f "$RESPONSE_FILE"
  exit 1
fi

if command -v jq >/dev/null 2>&1; then
  jq . "$RESPONSE_FILE"
else
  cat "$RESPONSE_FILE"
fi

rm -f "$RESPONSE_FILE"

echo ""
echo "--------------------------------------------------------"
