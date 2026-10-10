FROM mcr.microsoft.com/playwright:v1.49.1-noble

WORKDIR /app
COPY package.json .
RUN npm install

COPY test-src.js .
RUN npm run build

COPY index.html run-test.mjs run-reload-safety-test.mjs ./

CMD ["node", "run-test.mjs"]
