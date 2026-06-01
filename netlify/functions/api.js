const serverless = require('serverless-http');
const app = require('../../api-server');

// Export for Netlify Functions
module.exports.handler = serverless(app);
