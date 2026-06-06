FROM node:18-slim

# Install FFMPEG directly into the container so your transcoding features work!
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy and install node dependencies
COPY package*.json ./
RUN npm install --production

# Copy remaining application code
COPY . .

# Expose Hugging Face's required port
EXPOSE 7860
ENV PORT=7860

# Start the wrapper script instead of the serverless function
CMD [ "node", "index.js" ]
