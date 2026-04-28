#!/usr/bin/env node

const API_URL = process.env.API_URL || 'http://localhost:3000/api/chat';
const TOTAL_REQUESTS = parseInt(process.env.TOTAL_REQUESTS || process.argv[2] || '5', 10);
const CONCURRENCY = parseInt(process.env.CONCURRENCY || process.argv[3] || '1', 10);
const MESSAGE = process.env.MESSAGE || process.argv[4] || 'What kind of yoga pants do you have?';

if (!Number.isInteger(TOTAL_REQUESTS) || TOTAL_REQUESTS <= 0) {
  console.error('TOTAL_REQUESTS must be a positive integer.');
  process.exit(1);
}

if (!Number.isInteger(CONCURRENCY) || CONCURRENCY <= 0) {
  console.error('CONCURRENCY must be a positive integer.');
  process.exit(1);
}

let nextRequestId = 0;
let completed = 0;
let failed = 0;
const latencies = [];
const startedAt = Date.now();

async function runOne(requestId) {
  const requestStartedAt = Date.now();

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: `stress-${requestId}`,
        message: MESSAGE,
      }),
    });

    const latencyMs = Date.now() - requestStartedAt;
    latencies.push(latencyMs);

    if (!response.ok) {
      failed += 1;
      const body = await response.text().catch(() => '');
      console.error(`Request ${requestId} failed: HTTP ${response.status} ${body}`);
      return;
    }

    await response.json();
    completed += 1;
  } catch (error) {
    failed += 1;
    latencies.push(Date.now() - requestStartedAt);
    console.error(`Request ${requestId} failed: ${error.message}`);
  }
}

async function worker() {
  while (true) {
    const requestId = nextRequestId;
    nextRequestId += 1;

    if (requestId >= TOTAL_REQUESTS) {
      return;
    }

    await runOne(requestId);
  }
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

async function main() {
  console.log(`Stress testing ${API_URL}`);
  console.log(`Requests: ${TOTAL_REQUESTS}, concurrency: ${CONCURRENCY}`);
  console.log(`Message: "${MESSAGE}"`);
  console.log('');

  const workers = Array.from({ length: Math.min(CONCURRENCY, TOTAL_REQUESTS) }, () => worker());
  await Promise.all(workers);

  const durationMs = Date.now() - startedAt;
  const total = completed + failed;
  const averageLatency = latencies.length
    ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
    : 0;
  const throughput = durationMs > 0 ? ((completed * 1000) / durationMs).toFixed(2) : '0.00';

  console.log('Results');
  console.log(`Total: ${total}`);
  console.log(`Successful: ${completed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Wall time: ${durationMs} ms`);
  console.log(`Avg latency: ${averageLatency} ms`);
  console.log(`P50 latency: ${percentile(latencies, 50)} ms`);
  console.log(`P95 latency: ${percentile(latencies, 95)} ms`);
  console.log(`Throughput: ${throughput} req/s`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
