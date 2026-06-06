const http = require('http');
const handler = require('./api/server.js'); // Points to your original code

// Hugging Face strictly requires port 7860
const PORT = process.env.PORT || 7860;

const server = http.createServer((req, res) => {
  // Pass the request directly to your existing server script
  handler(req, res).catch(err => {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`IPTV Backend running 24/7 on port ${PORT}`);
});
