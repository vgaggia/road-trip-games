/**
 * Zero-dependency local HTTP + RFC 6455 WebSocket Hotspot Server (Node.js)
 * Mirrors the exact protocol of Android's HotspotGameServer.kt for local dev & E2E testing!
 *
 * Usage:
 *   node tools/dev-hotspot-server.mjs
 *   Host view:      http://localhost:8080/?native=1
 *   Passenger view: http://localhost:8080/
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.resolve(__dirname, '..', 'docs');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function detectLocalIPs() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const [name, addrs] of Object.entries(nets)) {
    for (const addr of addrs || []) {
      if (addr.family === 'IPv4' && !addr.internal) {
        out.push({ label: name, ip: addr.address });
      }
    }
  }
  if (out.length === 0) out.push({ label: 'Localhost', ip: '127.0.0.1' });
  return out;
}

export function createHotspotServer(port = 8080) {
  let hostSocket = null;
  let latestPublicState = null;
  let latestPrivateStates = {};
  const clients = new Map(); // playerId -> { socket, playerId, name, emoji, color, connected }
  const socketToRole = new Map(); // socket -> { isHost, playerId }

  function encodeWsFrame(text, opcode = 0x01) {
    const payload = Buffer.from(text, 'utf8');
    const len = payload.length;
    let header;
    if (len <= 125) {
      header = Buffer.alloc(2);
      header[0] = 0x80 | opcode;
      header[1] = len;
    } else if (len <= 65535) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    return Buffer.concat([header, payload]);
  }

  function wsSendJson(sock, obj) {
    if (!sock || sock.destroyed) return;
    try {
      sock.write(encodeWsFrame(JSON.stringify(obj), 0x01));
    } catch (_) {}
  }

  function broadcastPresenceToHost() {
    if (!hostSocket) return;
    const list = Array.from(clients.values()).map((c) => ({
      playerId: c.playerId,
      name: c.name,
      emoji: c.emoji,
      color: c.color,
      connected: c.connected
    }));
    wsSendJson(hostSocket, { type: 'presence', clients: list });
  }

  function handleWsMessage(sock, rawText) {
    let msg;
    try {
      msg = JSON.parse(rawText);
    } catch (_) {
      return;
    }
    if (!msg || !msg.type) return;

    if (msg.type === 'register_host') {
      hostSocket = sock;
      socketToRole.set(sock, { isHost: true, playerId: msg.hostId || 'host' });
      broadcastPresenceToHost();
      return;
    }

    if (msg.type === 'join_client' && msg.playerId) {
      const prev = clients.get(msg.playerId);
      if (prev && prev.socket && prev.socket !== sock) {
        socketToRole.delete(prev.socket);
      }
      clients.set(msg.playerId, {
        socket: sock,
        playerId: msg.playerId,
        name: String(msg.name || 'Passenger').slice(0, 16),
        emoji: String(msg.emoji || '🕶️'),
        color: String(msg.color || '#4cc9f0'),
        connected: true
      });
      socketToRole.set(sock, { isHost: false, playerId: msg.playerId });
      // Send cached state right away if available
      if (latestPublicState) {
        wsSendJson(sock, {
          type: 'state_update',
          publicState: latestPublicState,
          myState: latestPrivateStates[msg.playerId] || null
        });
      }
      broadcastPresenceToHost();
      return;
    }

    if (msg.type === 'host_sync' && sock === hostSocket) {
      latestPublicState = msg.publicState || null;
      latestPrivateStates = msg.privateStates || {};
      for (const [pid, client] of clients.entries()) {
        if (client.connected && client.socket) {
          wsSendJson(client.socket, {
            type: 'state_update',
            publicState: latestPublicState,
            myState: latestPrivateStates[pid] || null
          });
        }
      }
      return;
    }

    if (msg.type === 'host_event' && sock === hostSocket) {
      for (const client of clients.values()) {
        if (client.connected && client.socket) {
          wsSendJson(client.socket, { type: 'host_event', event: msg.event });
        }
      }
      return;
    }

    if (msg.type === 'client_action' && msg.playerId) {
      if (hostSocket) {
        wsSendJson(hostSocket, {
          type: 'client_action',
          playerId: msg.playerId,
          action: msg.action
        });
      }
    }
  }

  const server = http.createServer((req, res) => {
    const parsed = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (parsed.pathname === '/api/server-info') {
      const actualPort = server.address()?.port || port;
      const ips = detectLocalIPs();
      const payload = JSON.stringify({
        mode: 'hotspot',
        port: actualPort,
        ips,
        primaryUrl: `http://${ips[0].ip}:${actualPort}`,
        roomCode: 'RIDE'
      });
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end(payload);
      return;
    }

    let rel = parsed.pathname === '/' ? '/index.html' : parsed.pathname;
    rel = path.posix.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '');
    const filePath = path.join(DOCS_DIR, rel);
    if (!filePath.startsWith(DOCS_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  });

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }
    const accept = crypto
      .createHash('sha1')
      .update(key.trim() + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    socket.setNoDelay(true);

    let buffer = Buffer.alloc(0);
    let fragments = [];

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 2) {
        const b0 = buffer[0];
        const b1 = buffer[1];
        const fin = (b0 & 0x80) !== 0;
        const opcode = b0 & 0x0f;
        const masked = (b1 & 0x80) !== 0;
        let len = b1 & 0x7f;
        let offset = 2;

        if (len === 126) {
          if (buffer.length < 4) return;
          len = buffer.readUInt16BE(2);
          offset = 4;
        } else if (len === 127) {
          if (buffer.length < 10) return;
          len = Number(buffer.readBigUInt64BE(2));
          offset = 10;
        }

        const maskLen = masked ? 4 : 0;
        if (buffer.length < offset + maskLen + len) return;

        const payload = Buffer.from(buffer.subarray(offset + maskLen, offset + maskLen + len));
        if (masked) {
          const mask = buffer.subarray(offset, offset + 4);
          for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
        }
        buffer = buffer.subarray(offset + maskLen + len);

        if (opcode === 0x08) {
          // Close
          try { socket.end(encodeWsFrame('', 0x08)); } catch (_) {}
          return;
        } else if (opcode === 0x09) {
          // Ping -> Pong
          const pong = Buffer.concat([Buffer.from([0x8a, payload.length]), payload]);
          try { socket.write(pong); } catch (_) {}
        } else if (opcode === 0x01 || opcode === 0x00) {
          fragments.push(payload);
          if (fin) {
            const full = Buffer.concat(fragments).toString('utf8');
            fragments = [];
            handleWsMessage(socket, full);
          }
        }
      }
    });

    const onDisconnect = () => {
      const info = socketToRole.get(socket);
      socketToRole.delete(socket);
      if (!info) return;
      if (info.isHost && hostSocket === socket) {
        hostSocket = null;
      } else if (!info.isHost && info.playerId) {
        const entry = clients.get(info.playerId);
        if (entry && entry.socket === socket) {
          entry.connected = false;
          entry.socket = null;
          broadcastPresenceToHost();
        }
      }
    };

    socket.on('close', onDisconnect);
    socket.on('error', onDisconnect);
  });

  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8080;
  const srv = createHotspotServer(port);
  srv.listen(port, '0.0.0.0', () => {
    console.log(`Shotgun! Hotspot Dev Server listening on:`);
    console.log(`  Host APK view:  http://localhost:${port}/?native=1`);
    console.log(`  Passenger view: http://localhost:${port}/`);
  });
}
