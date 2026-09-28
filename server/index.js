// HTTP(S)-Server: liefert den Client aus und hält den WebSocket für Spiel & Signaling.
import express from 'express';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);

const app = express();
app.use(express.static(path.join(root, 'public')));
app.use('/shared', express.static(path.join(root, 'shared')));
app.use('/vendor/three', express.static(path.join(root, 'node_modules/three')));

// ICE-Server für WebRTC. Für Spieler hinter strikten NATs einen TURN-Server per ICE_SERVERS (JSON) eintragen.
app.get('/config.json', (_req, res) => {
  let iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (process.env.ICE_SERVERS) {
    try { iceServers = JSON.parse(process.env.ICE_SERVERS); } catch { console.warn('ICE_SERVERS ist kein gültiges JSON.'); }
  }
  res.json({ iceServers });
});

let server;
if (process.env.HTTPS_KEY && process.env.HTTPS_CERT) {
  server = https.createServer({ key: fs.readFileSync(process.env.HTTPS_KEY), cert: fs.readFileSync(process.env.HTTPS_CERT) }, app);
} else {
  server = http.createServer(app);
}

const room = new Room();
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  room.connect(ws);
});
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 20000);

server.listen(PORT, () => {
  const proto = server instanceof https.Server ? 'https' : 'http';
  console.log(`🍺 KoppelDopf läuft auf ${proto}://localhost:${PORT}`);
});
