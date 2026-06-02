var http = require('http');
var https = require('https');
var crypto = require('crypto');
var spawn = require('child_process').spawn;

var ffmpegPath = null;
function getFfmpeg() {
  if (ffmpegPath !== null) return ffmpegPath || null;
  try {
    var r = require('child_process').execSync('which ffmpeg').toString().trim();
    if (r) { ffmpegPath = r; return r; }
  } catch(e) {}
  ffmpegPath = false;
  return null;
}

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
      if (idx >= candidates.length) return reject(new Error('Portal path not found. Tried: ' + tried.join(', ')));
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

function proxyStream(url, method, token, mac) {
  return new Promise(function(resolve, reject) {
    var uTarget = new URL(url);
    var mod = uTarget.protocol === 'https:' ? https : http;
    var headers = { 'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3', 'Accept': '*/*' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (mac) headers['Cookie'] = 'mac=' + mac;
    var opts = {
      hostname: uTarget.hostname, port: uTarget.port || (uTarget.protocol === 'https:' ? 443 : 80),
      path: uTarget.pathname + uTarget.search, method: method || 'GET',
      headers: headers, rejectUnauthorized: false,
    };
    var proxyReq = mod.request(opts, function(proxyRes) {
      var chunks = [];
      proxyRes.on('data', function(c) { chunks.push(c); });
      proxyRes.on('end', function() {
        resolve({ statusCode: proxyRes.statusCode, headers: proxyRes.headers, data: Buffer.concat(chunks) });
      });
    });
    proxyReq.on('error', reject);
    proxyReq.end();
  });
}

module.exports = async function(req, res) {
  var path = req.url ? req.url.split('?')[0] : '/';
  var method = req.method;
  var body = '';
  
  try {
    body = await new Promise(function(resolve, reject) {
      var chunks = [];
      req.on('data', function(c) { chunks.push(c); });
      req.on('end', function() { resolve(Buffer.concat(chunks).toString()); });
      req.on('error', reject);
    });
  } catch(e) { body = ''; }
  
  function jsonResponse(statusCode, data) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(data));
  }
  
  try { body = JSON.parse(body || '{}'); } catch(e) { body = {}; }
  
  if (path === '/api/status') return jsonResponse(200, { ok: true, ffmpeg: !!getFfmpeg(), node: process.version });
  
  if (path === '/api/stalker/handshake' && method === 'POST') {
    var mac = body.mac, portalUrl = body.portal_url;
    if (!mac || !portalUrl) return jsonResponse(400, { error: 'Missing mac or portal_url' });
    try {
      var portalPath = await resolvePortalPath(portalUrl, mac);
      return jsonResponse(200, { portal_path: portalPath, status: 'ok' });
    } catch(e) { return jsonResponse(500, { error: e.message }); }
  }
  
  if (path === '/api/stalker/channels' && method === 'POST') {
    var mac = body.mac, token = body.token, portalUrl = body.portal_url, portalPath = body.portal_path;
    if (!mac || !portalUrl) return jsonResponse(400, { error: 'Missing mac or portal_url' });
    try {
      var url = portalUrl.replace(/\/$/, '') + (portalPath || '/c/') + 'channels.json';
      var resp = await stbHttpGet(url, mac, token, 20000);
      if (resp.statusCode === 200) return jsonResponse(200, JSON.parse(resp.data.toString()));
      else return jsonResponse(resp.statusCode, { error: 'Portal returned ' + resp.statusCode });
    } catch(e) { return jsonResponse(500, { error: e.message }); }
  }
  
  if (path === '/api/stalker/itv' && method === 'POST') {
    var mac = body.mac, token = body.token, portalUrl = body.portal_url, portalPath = body.portal_path;
    if (!mac || !portalUrl) return jsonResponse(400, { error: 'Missing mac or portal_url' });
    try {
      var url = portalUrl.replace(/\/$/, '') + (portalPath || '/c/') + 'itv.json';
      var resp = await stbHttpGet(url, mac, token, 20000);
      if (resp.statusCode === 200) return jsonResponse(200, JSON.parse(resp.data.toString()));
      else return jsonResponse(resp.statusCode, { error: 'Portal returned ' + resp.statusCode });
    } catch(e) { return jsonResponse(500, { error: e.message }); }
  }
  
  if (path === '/fetch' && method === 'GET') {
    var target = require('url').parse(req.url, true).query.url;
    if (!target) return jsonResponse(400, { error: 'Missing url' });
    try {
      var resp = await proxyStream(target, 'GET', null, null);
      return jsonResponse(resp.statusCode, resp.data.toString());
    } catch(e) { return jsonResponse(502, { error: e.message }); }
  }
  
  return jsonResponse(404, { error: 'Not found' });
};