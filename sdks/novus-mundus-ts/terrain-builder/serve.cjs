#!/usr/bin/env node
// Zero-dependency Node.js server for Terrain Blender
// Serves terrain-blender.html and provides REST API for data/ folder
// Usage: node serve.js [port]

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2]) || 3333;
const DIR = __dirname;
const DATA_DIR = path.join(DIR, 'data');

// Ensure data/ exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.mjs':  'application/javascript',
  '.json': 'application/json',
  '.css':  'text/css',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
  '.glb':  'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.ogg':  'audio/ogg',
  '.mp3':  'audio/mpeg',
  '.wav':  'audio/wav',
  '.hdr':  'application/octet-stream',
  '.wasm': 'application/wasm',
};

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function safeName(name) {
  // Only allow alphanumeric, dash, underscore, dot — prevent path traversal
  return /^[a-zA-Z0-9_\-\.]+\.json$/.test(name);
}

const server = http.createServer(async (req, res) => {
  const method = req.method;
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // ── API: List files ──
  if (method === 'GET' && pathname === '/api/files') {
    try {
      const files = fs.readdirSync(DATA_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => {
          const stat = fs.statSync(path.join(DATA_DIR, f));
          return { name: f, size: stat.size, modified: stat.mtime.toISOString() };
        })
        .sort((a, b) => b.modified.localeCompare(a.modified));
      sendJSON(res, 200, { files });
    } catch (e) {
      sendJSON(res, 500, { error: e.message });
    }
    return;
  }

  // ── API: Read file ──
  const readMatch = pathname.match(/^\/api\/files\/(.+)$/);
  if (method === 'GET' && readMatch) {
    const name = decodeURIComponent(readMatch[1]);
    if (!safeName(name)) return sendJSON(res, 400, { error: 'Invalid filename' });
    const filePath = path.join(DATA_DIR, name);
    if (!fs.existsSync(filePath)) return sendJSON(res, 404, { error: 'Not found' });
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(content);
    } catch (e) {
      sendJSON(res, 500, { error: e.message });
    }
    return;
  }

  // ── API: Save file ──
  if (method === 'POST' && readMatch) {
    const name = decodeURIComponent(readMatch[1]);
    if (!safeName(name)) return sendJSON(res, 400, { error: 'Invalid filename' });
    try {
      const body = await readBody(req);
      // Validate it's valid JSON
      JSON.parse(body);
      fs.writeFileSync(path.join(DATA_DIR, name), body, 'utf-8');
      sendJSON(res, 200, { ok: true, name });
    } catch (e) {
      sendJSON(res, 400, { error: e.message });
    }
    return;
  }

  // ── API: Delete file ──
  if (method === 'DELETE' && readMatch) {
    const name = decodeURIComponent(readMatch[1]);
    if (!safeName(name)) return sendJSON(res, 400, { error: 'Invalid filename' });
    const filePath = path.join(DATA_DIR, name);
    if (!fs.existsSync(filePath)) return sendJSON(res, 404, { error: 'Not found' });
    try {
      fs.unlinkSync(filePath);
      sendJSON(res, 200, { ok: true });
    } catch (e) {
      sendJSON(res, 500, { error: e.message });
    }
    return;
  }

  // ── Static files ──
  let filePath;
  if (pathname === '/' || pathname === '/index.html') {
    filePath = path.join(DIR, 'terrain-blender.html');
  } else {
    filePath = path.join(DIR, pathname.slice(1));
  }

  // Prevent path traversal
  if (!filePath.startsWith(DIR)) {
    res.writeHead(403); res.end('Forbidden');
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404); res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`\n  Terrain Blender server running at:\n`);
  console.log(`    http://localhost:${PORT}\n`);
  console.log(`  Data folder: ${DATA_DIR}\n`);
});
