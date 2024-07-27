FROM node:lts-alpine

# Set the working directory
WORKDIR /opt/invidious-stripped-down

# Copy index.js to the working directory
COPY index.js .

# Install npm dependencies
COPY package*.json ./
RUN npm install

# Run index.js with Node.js
CMD ["node", "index.js"]