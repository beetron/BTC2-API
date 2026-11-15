FROM node:24.10.0-alpine3.22

WORKDIR /app

# Install curl for docker healthchecks
RUN apk add --no-cache curl

# Copy package files
COPY package*.json ./

# Prep empty directories for docker volume mounts
RUN mkdir -p /app/src/users/profileImage

# Install dependencies
RUN npm install --production

# Copy app source
COPY . .

EXPOSE 3000

# Run node directly instead of "npm start": npm does not reliably pass
# SIGTERM on to node, so the graceful shutdown in server.js would never run
# and Kubernetes would kill the pod after its full grace period
CMD ["node", "server.js"]