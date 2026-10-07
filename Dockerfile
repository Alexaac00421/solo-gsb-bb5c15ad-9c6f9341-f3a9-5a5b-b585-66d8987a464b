# ---- 构建阶段：安装依赖并编译前后端 ----
FROM node:20-bookworm-slim AS build
WORKDIR /app

# better-sqlite3 若无对应预编译包时可回退源码编译
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# 先拷贝各工作区清单，尽量利用 Docker 缓存
COPY package.json package-lock.json* ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm install

# 拷贝源码并构建（输出：shared/dist、server/dist、web/dist）
COPY tsconfig.base.json ./
COPY shared ./shared
COPY server ./server
COPY web ./web
RUN npm run build

# ---- 运行阶段 ----
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# 直接复用已安装好的 node_modules（含 better-sqlite3 原生模块）与构建产物
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/shared/package.json ./shared/package.json
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist

ENV PORT=8080
ENV DB_PATH=/app/data/cue-sheet.sqlite
ENV STATIC_DIR=/app/web/dist
# 首次启动自动建库建表；数据目录挂载为卷
RUN mkdir -p /app/data
EXPOSE 8080

CMD ["node", "server/dist/server/src/index.js"]
