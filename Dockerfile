# FROM node:14.15.4-alpine
FROM node:22-alpine
# Create app directory
WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install --legacy-peer-deps
# If you are building your code for production
# RUN npm ci --only=production

# Bundle app source
COPY . .

EXPOSE 3098
CMD [ "node", "index.js" ]
