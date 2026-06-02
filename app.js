const express = require('express');
const serverless = require('serverless-http');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const spawn = require('child_process').spawn;

var ffmpegPath = null;
function detectFfmpeg() {
  if (ffmpegPath !== null) return ffmpegPath || null;
  try {
    var r = require('child_process').execSync('which ffmpeg').toString().trim();
    if (r) { ffmpegPath = r; return r; }
  } catch(e) {}
  try {
    var p = require('ffmpeg-static');
    if (p) { ffmpegPath = p; return p; }
  } catch(e) {}
  ffmpegPath = false; return null;
}

const app = express();
app.use(express.json());
app.use(function(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  next();
});

function stbSerial(mac) {
  return crypto.createHash('md5').update(mac.replace(/:/g, '').toUpperCase()).digest('hex').slice(0, 13).toUpperCase();
}
function stbDeviceId(mac) {
  return crypto.createHash('sha256').update(mac.replace(/:/g, '').toUpperCase()).digest('hex').slice(0, 64).toUpperCase();
}
function stbHeaders(mac, token) {
  var h = {
    'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
    'X-User-Agent': 'Model: MAG200; Link: Ethernet',
    'Cookie': 'mac=' + mac + '; stb_lang=en; timezone=Europe/London',
    'Accept': '*/*',
  };
  if (token) h['Authorization'] = 'Bearer ' + token;
  return h;
}
function stbHttpGet(baseUrl, mac, token, timeout) {
  return stbHttpGetFollow(baseUrl, mac, token, timeout || 15000, 0);
}
function stbHttpGetFollow(baseUrl, mac, token, timeout, depth) {
  if (depth > 5) return Promise.reject(new Error('Too many redirects'));
  return new Promise(function(resolve, reject) {
    var u = new URL(baseUrl);
    var mod = u.protocol === 'https:' ? https : http;
    var opts = {
      hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search, method: 'GET',
      headers: stbHeaders(mac, token), rejectUnauthorized: false, timeout: timeout || 15000,
    };
    var req = mod.request(opts, function(res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return stbHttpGetFollow(res.headers.location, mac, token, timeout, depth + 1).then(resolve).catch(reject);
      }
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        try { resolve({ statusCode: res.statusCode, headers: res.headers, data: Buffer.concat(chunks) }); } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', function() { req.destroy(); reject(new Error('Request timeout')); });
    req.end();
  });
}

var PATH_CANDIDATES = [
  '/portal.php', '/c/portal.php', '/stalker_portal/c/portal.php',
  '/c/server/load.php', '/server/load.php', '/stalker_portal/server/load.php',
  '/c/', '/stalker_portal/c/', '/api/', '/stalker_portal/api/', '/api/v3/', '/server/api/',
];
var resolvedCache = {};
function resolvePortalPath(baseUrl, mac, userPath) {
  var cacheKey = baseUrl + '|' + (userPath || '');
  if (resolvedCache[cacheKey]) return Promise.resolve(resolvedCache[cacheKey]);
  return new Promise(function(resolve, reject) {
    var idx = 0, tried = [], candidates = PATH_CANDIDATES.slice();
    if (userPath) candidates.unshift(userPath + '/portal.php', userPath + '/server/load.php', userPath + '/load.php');
    function tryCandidate() {
      if (idx >= candidates.length) { return reject(new Error('Portal path not found. Tried: ' + tried.join(', '))); }
      var candidate = candidates[idx++];
      var url = baseUrl.replace(/\/$/, '') + candidate;
      tried.push(candidate);
      stbHttpGet(url, mac, null, 8000).then(function(resp) {
        if (resp.statusCode === 200 && (resp.data.length > 100 || candidate.includes('/c/') || candidate.includes('/api/'))) {
          resolvedCache[cacheKey] = candidate; resolve(candidate);
        } else { tryCandidate(); }
      }).catch(function() { tryCandidate(); });
    }
    tryCandidate();
  });
}

function proxyStream(res, url, method, token, portal, mac, cmd, transcode) {
  var uTarget = new URL(url);
  var mod = uTarget.protocol === 'https:' ? https : http;
  var headers = { 'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3', 'Accept': '*/*' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (mac) headers['Cookie'] = 'mac=' + mac;
  if (transcode) {
    var fp = detectFfmpeg();
    if (fp) {
      var ffmpeg = spawn(fp, [
        '-i', url, '-c:v', 'libx264', '-preset', 'fast', '-crf', '28',
        '-c:a', 'aac', '-b:a', '128k', '-f', 'mpegts', 'pipe:1'
      ]);
      ffmpeg.stdout.on('data', function(chunk) { res.write(chunk); });
      ffmpeg.stderr.on('data', function(data) { console.log('[ffmpeg]', data.toString()); });
      ffmpeg.on('close', function(code) { res.end(); });
      ffmpeg.on('error', function(err) {
        if (!res.headersSent) { res.writeHead(500); res.end('FFmpeg error: ' + err.message); }
      });
      return;
    }
  }
  var opts = {
    hostname: uTarget.hostname, port: uTarget.port || (uTarget.protocol === 'https:' ? 443 : 80),
    path: uTarget.pathname + uTarget.search, method: method || 'GET',
    headers: headers, rejectUnauthorized: false,
  };
  var proxyReq = mod.request(opts, function(proxyRes) {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on('error', function(err) { res.writeHead(502); res.end('Proxy error: ' + err.message); });
  proxyReq.end();
}

app.get('/fetch', function(req, res) {
  var target = req.query.url, uTarget = new URL(target);
  var mod = uTarget.protocol === 'https:' ? https : http;
  var opts = {
    hostname: uTarget.hostname, port: uTarget.port || (uTarget.protocol === 'https:' ? 443 : 80),
    path: uTarget.pathname + uTarget.search, method: 'GET',
    headers: { 'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; Android C)' }, rejectUnauthorized: false,
  };
  var proxyReq = mod.request(opts, function(proxyRes) {
    var chunks = [];
    proxyRes.on('data', function(c) { chunks.push(c); });
    proxyRes.on('end', function() {
      var data = Buffer.concat(chunks);
      res.writeHead(proxyRes.statusCode, { 'Content-Type': proxyRes.headers['content-type'] || 'text/plain' });
      res.end(data);
    });
  });
  proxyReq.on('error', function(err) { res.writeHead(502); res.end('Proxy error: ' + err.message); });
  proxyReq.end();
});

app.get('/proxy/stream', function(req, res) {
  proxyStream(res, req.query.url, req.method, req.query.token || '', req.query.portal || '', req.query.mac || '', req.query.cmd || '', req.query.transcode === 'true' || req.query.transcode === '1');
});

app.all('/api/stalker/handshake', function(req, res) {
  var mac = req.body && req.body.mac;
  var portalUrl = req.body && req.body.portal_url;
  if (!mac || !portalUrl) return res.status(400).json({ error: 'Missing mac or portal_url' });
  resolvePortalPath(portalUrl, mac).then(function(path) { res.json({ portal_path: path, status: 'ok' }); })
    .catch(function(err) { res.status(500).json({ error: err.message }); });
});

app.all('/api/stalker/channels', function(req, res) {
  var mac = req.body && req.body.mac, token = req.body && req.body.token;
  var portalUrl = req.body && req.body.portal_url, portalPath = req.body && req.body.portal_path;
  if (!mac || !portalUrl) return res.status(400).json({ error: 'Missing mac or portal_url' });
  var url = portalUrl.replace(/\/$/, '') + (portalPath || '/c/') + 'channels.json';
  stbHttpGet(url, mac, token, 20000).then(function(resp) {
    if (resp.statusCode === 200) {
      try { res.json(JSON.parse(resp.data.toString())); } catch(e) { res.status(500).json({ error: 'Invalid JSON from portal' }); }
    } else { res.status(resp.statusCode).json({ error: 'Portal returned ' + resp.statusCode }); }
  }).catch(function(err) { res.status(500).json({ error: err.message }); });
});

app.all('/api/stalker/itv', function(req, res) {
  var mac = req.body && req.body.mac, token = req.body && req.body.token;
  var portalUrl = req.body && req.body.portal_url, portalPath = req.body && req.body.portal_path;
  if (!mac || !portalUrl) return res.status(400).json({ error: 'Missing mac or portal_url' });
  var url = portalUrl.replace(/\/$/, '') + (portalPath || '/c/') + 'itv.json';
  stbHttpGet(url, mac, token, 20000).then(function(resp) {
    if (resp.statusCode === 200) {
      try { res.json(JSON.parse(resp.data.toString())); } catch(e) { res.status(500).json({ error: 'Invalid JSON from portal' }); }
    } else { res.status(resp.statusCode).json({ error: 'Portal returned ' + resp.statusCode }); }
  }).catch(function(err) { res.status(500).json({ error: err.message }); });
});

app.get('/api/status', function(req, res) {
  var fp = detectFfmpeg();
  res.json({ ok: true, ffmpeg: !!fp, env: process.env.NODE_ENV || 'unknown' });
});

var wrapped = serverless(app);
module.exports = app;
module.exports.handler = wrapped;
