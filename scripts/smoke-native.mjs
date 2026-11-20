/**
 * Smoke of original Buffalo backend and PySD evaluation simulator.
 * No API keys, remote model requests, or claim of agent modeling success.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';
import SDJsonToXMILE from '../utilities/SDJsonToXMILE.js';
import PySDSimulator from '../evals/utilities/simulator/PySDSimulator.js';

const port = 31458;
const base = 'http://127.0.0.1:' + port;

async function waitForServer(child) {
  for (let i = 0; i < 90; i++) {
    if (child.exitCode !== null) throw new Error('Server exited: ' + child.exitCode);
    try {
      const res = await fetch(base + '/status', { signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        assert.equal((await res.json()).status, 'ok');
        return;
      }
    } catch { /* waiting for native engine warm-up */ }
    await sleep(1000);
  }
  throw new Error('Server /status unavailable after 90 seconds');
}

async function checkAgentSession() {
  // Matches the WebSocketServer path in app.js; README has a different example.
  const socket = new WebSocket('ws://127.0.0.1:' + port + '/api/v1', { handshakeTimeout: 10000 });
  try {
    const ready = await new Promise((resolve, reject) => {
      let settled = false;
      const watchdog = setTimeout(() => finish(reject, new Error('Agent handshake timeout')), 20000);
      function finish(callback, value) {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        callback(value);
      }
      socket.on('error', e => finish(reject, e));
      socket.on('close', (code, reason) => finish(reject, new Error('Socket closed: ' + code + ' ' + reason)));
      socket.on('message', bytes => {
        try {
          const msg = JSON.parse(String(bytes));
          if (msg.type === 'error') throw new Error('Agent server error: ' + msg.error);
          if (msg.type === 'session_created') {
            socket.send(JSON.stringify({
              type: 'initialize_session',
              sessionId: msg.sessionId,
              authenticationKey: '', // Required by MessageProtocol schema, even with no server secret
              clientProduct: 'buffalo-01-smoke',
              clientId: 'buffalo-01-smoke-local', // required by SessionManager.initializeSession even if schema says optional
              clientVersion: '1.0',
              mode: 'sfd',
              model: {
                variables: [],
                relationships: [],
                specs: { startTime: 0, stopTime: 10, dt: 1, timeUnits: 'minutes' }
              },
              tools: []
            }));
          }
          if (msg.type === 'session_ready') finish(resolve, msg);
        } catch (e) {
          finish(reject, e);
        }
      });
    });
    const ids = new Set((ready.availableAgents || []).map(agent => agent.id));
    for (const id of ['merlin', 'socrates', 'themis', 'athena_SFD', 'athena_CLD']) {
      assert.ok(ids.has(id), 'Missing expected agent ' + id + '; found ' + [...ids].join(', '));
    }
    console.log('PASS: agent handshake and original agent configurations');
  } finally {
    socket.close();
  }
}

async function checkNativePySD() {
  const sdjson = {
    variables: [
      { name: 'Inventory', type: 'stock', equation: '10', inflows: ['Supply'], outflows: ['Demand'] },
      { name: 'Supply', type: 'flow', equation: '2', uniflow: true },
      { name: 'Demand', type: 'flow', equation: '1', uniflow: true }
    ],
    relationships: [],
    specs: { startTime: 0, stopTime: 10, dt: 1, timeUnits: 'minutes', integrationMethod: 'Euler' }
  };
  const python = process.env.BUFFALO_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const result = await new PySDSimulator(SDJsonToXMILE(sdjson), python).simulate(['Inventory']);
  assert.ok(Array.isArray(result.time) && result.time.length >= 2);
  assert.ok(Array.isArray(result.Inventory) && result.Inventory.length === result.time.length);
  const actual = result.Inventory.at(-1);
  assert.ok(Math.abs(actual - 20) < 0.0001, 'Final inventory should be 20, got ' + actual);
  console.log('PASS: native SD-JSON -> XMILE -> PySD (Inventory=20)');
}

const child = spawn(process.execPath, ['app.js'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), WEBSOCKET_PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
for (const stream of [child.stdout, child.stderr]) {
  stream.on('data', chunk => { log = (log + String(chunk)).slice(-12000); });
}
try {
  await waitForServer(child);
  console.log('PASS: native HTTP /status');
  await checkAgentSession();
  await checkNativePySD();
  console.log('PASS: infrastructure smoke; no LLM calls and no agent-modeling claim');
} catch (e) {
  console.error('FAIL:', e);
  console.error('Server log tail:\n' + log);
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
}
