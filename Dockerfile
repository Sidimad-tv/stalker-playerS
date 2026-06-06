FROM node:18-slim

WORKDIR /app

# Copy dependency definitions
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy all project files
COPY . .

# Expose port 7860 (Hugging Face requires this exact port)
EXPOSE 7860

# Set environment variable so your server listens on the correct port
ENV PORT=7860

# Start your Node.js application
CMD [ "node", "api/server.js" ]
