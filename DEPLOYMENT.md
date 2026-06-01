# Deployment Guide

This project is configured for both Vercel and Netlify deployment.

## Vercel Deployment

1. **Install Vercel CLI:**
   ```bash
   npm install -g vercel
   ```

2. **Deploy:**
   ```bash
   vercel
   ```

3. **Configuration files:**
   - `vercel.json` - Vercel configuration
   - `api/server.js` - Serverless function for API routes
   - `api-server.js` - Express app for serverless deployment

## Netlify Deployment

1. **Install Netlify CLI:**
   ```bash
   npm install -g netlify-cli
   ```

2. **Deploy:**
   ```bash
   netlify deploy --prod
   ```

3. **Configuration files:**
   - `netlify.toml` - Netlify configuration
   - `netlify/functions/server.js` - Serverless function
   - `netlify/functions/package.json` - Function dependencies

## Project Structure

- `server.js` - Original Node.js server (for local development)
- `api-server.js` - Express app adapted for serverless deployment
- `api/` - Vercel serverless functions
- `netlify/functions/` - Netlify serverless functions
- `stalker.html` - Frontend application
- `js/` - JavaScript dependencies
- `css/` - CSS stylesheets

## API Endpoints

- `/api/stalker/*` - Stalker middleware API
- `/proxy/stream` - Stream proxy endpoint
- `/fetch` - Legacy fetch proxy

## Environment Variables

No additional environment variables required for basic deployment.

## Local Development

Run the original server:
```bash
node server.js
```

Access at: `http://localhost:3000/stalker.html`
