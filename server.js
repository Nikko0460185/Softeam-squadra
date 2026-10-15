'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT     = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const PORT     = process.env.PORT || 3000;

const FILES = {
  consultants: path.join(DATA_DIR, 'consultants.json'),
  prestations: path.join(DATA_DIR, 'prestations.json'),
  opportunites: path.join(DATA_DIR, 'opportunites.json'),
  candidatures: path.join(DATA_DIR, 'candidatures.json'),
  commerciaux: path.join(DATA_DIR, 'commerciaux.json'),
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function serveStatic(req, res) {
  const urlPath  = decodeURIComponent(req.url.split('?')[0]);
  const relPath  = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = path.normalize(path.join(ROOT, relPath));

  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }

  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

function handleGetData(req, res) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  sendJson(res, 200, {
    consultants: readJson(FILES.consultants) || [],
    prestations: readJson(FILES.prestations) || [],
    opportunites: readJson(FILES.opportunites) || [],
    candidatures: readJson(FILES.candidatures) || [],
    commerciaux: readJson(FILES.commerciaux) || [],
  });
}

function handlePostData(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    let data;
    try { data = JSON.parse(body); } catch { sendJson(res, 400, { error: 'JSON invalide' }); return; }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILES.consultants, JSON.stringify(data.consultants || [], null, 2));
    fs.writeFileSync(FILES.prestations, JSON.stringify(data.prestations || [], null, 2));
    fs.writeFileSync(FILES.opportunites, JSON.stringify(data.opportunites || [], null, 2));
    fs.writeFileSync(FILES.candidatures, JSON.stringify(data.candidatures || [], null, 2));
    fs.writeFileSync(FILES.commerciaux, JSON.stringify(data.commerciaux || [], null, 2));
    sendJson(res, 200, { ok: true });
  });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/data')) {
    if (req.method === 'GET')  return handleGetData(req, res);
    if (req.method === 'POST') return handlePostData(req, res);
    res.writeHead(405); res.end('Method not allowed'); return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`SQUADRA disponible sur http://localhost:${PORT}`);
});
