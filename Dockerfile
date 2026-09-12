# syntax=docker/dockerfile:1

FROM node:22-alpine

LABEL org.opencontainers.image.title="CloudSearch" \
      org.opencontainers.image.description="云搜 — 聚合网盘资源搜索应用" \
      org.opencontainers.image.source="https://github.com/kunz-kun/cloudsearch"

WORKDIR /app

# 项目零依赖，无需 npm install，直接拷贝源码
COPY package.json ./
COPY config.json ./
COPY server.js ./
COPY public ./public

# 容器内必须监听 0.0.0.0，否则容器外访问不到
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787

EXPOSE 8787

# 以非 root 用户运行（node 镜像内置该用户）
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "server.js"]
