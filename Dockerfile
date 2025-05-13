FROM node:24-slim

WORKDIR /src

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy app source
COPY . .

EXPOSE 443

CMD ["npm", "start"]