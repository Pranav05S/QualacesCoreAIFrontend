# Audit service container. The Playwright base image already contains Chromium and its system libraries.
# The image tag must match the playwright-core version in package.json.
FROM mcr.microsoft.com/playwright:v1.52.0-noble

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src

ENV NODE_ENV=production PORT=8787
# Run as the unprivileged user that ships with the image.
USER pwuser
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "src/server.js"]
