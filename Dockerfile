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

CMD ["npm", "start"]