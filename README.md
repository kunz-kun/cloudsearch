# 云搜 CloudSearch

聚合网盘资源搜索应用。一个搜索框，同时检索夸克、阿里云盘、百度网盘、迅雷、UC、123、天翼、115、PikPak、磁力等多个来源，结果自动归并去重。

界面简洁清新，零第三方依赖（Node 内置模块 + 原生前端）。

![搜索结果](shots/04-merged.png)

## 快速开始

```bash
node server.js
```

然后打开 <http://127.0.0.1:8787>。

端口被占用时会自动顺延到 8788、8789……

## Docker 部署（Linux VPS）

### 方式一：docker compose（推荐）

```bash
git clone https://github.com/kunz-kun/cloudsearch.git
cd cloudsearch
docker compose up -d --build
```

默认映射到宿主的 `8787` 端口。想换端口：

```bash
CS_PORT=9000 docker compose up -d
```

查看状态与日志：

```bash
docker compose ps
docker compose logs -f
```

停止 / 更新：

```bash
docker compose down
git pull && docker compose up -d --build
```

### 方式二：docker run

```bash
git clone https://github.com/kunz-kun/cloudsearch.git
cd cloudsearch
docker build -t cloudsearch .
docker run -d \
  --name cloudsearch \
  --restart unless-stopped \
  -p 8787:8787 \
  cloudsearch
```

### 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | 本地 `127.0.0.1`；镜像内 `0.0.0.0` | 监听地址。**容器里必须是 `0.0.0.0`**，否则容器外访问不到 |
| `PORT` | `8787` | 监听端口。一旦由环境变量指定，端口冲突时**不再自动顺延**，避免端口映射失效 |

环境变量优先级高于 `config.json`。镜像内置 `HEALTHCHECK`，每 30 秒探活 `/api/health`，`docker ps` 可直接看到健康状态。

### 放到公网前请注意

- **本服务没有任何鉴权**——谁访问到你的地址，都能用你的服务器去搜网盘。建议只在内网使用，
  或者按下一节用 Caddy 套一层 Basic Auth。
- 建议用 Nginx / Caddy 加 HTTPS，并配好防火墙，只放行需要的端口。
- 上游是第三方公开服务，高频访问可能被限流；程序已内置 5 分钟结果缓存来缓解。

### 加 HTTPS 与密码保护（Caddy，推荐）

仓库自带 `Caddyfile` 和 `docker-compose.caddy.yml`，自动 HTTPS + 密码保护一次搞定。

**第 1 步：生成密码哈希**

```bash
docker run --rm caddy:2-alpine caddy hash-password --plaintext '你的密码'
```

会输出一串 `$2a$14$...`，复制备用。

**第 2 步：建一个 `.env` 文件**（别提交到 git）

```bash
DOMAIN=search.example.com
AUTH_USER=kun
AUTH_HASH=$2a$14$把刚才的哈希粘到这里
```

**第 3 步：启动**

```bash
docker compose -f docker-compose.caddy.yml up -d --build
```

这个 compose 文件里云搜**不再映射到宿主端口**，只在内网暴露给 Caddy——
就算密码没配好，外面也碰不到。Caddy 会自动申请 Let's Encrypt 证书并把 HTTP 跳转到 HTTPS，
证书存在 `caddy_data` 卷里（别删，删了重启要重新签发）。

访问 `https://你的域名`，浏览器会先弹账号密码框。

> **没有域名？** 把 `Caddyfile` 首行的 `{$DOMAIN}` 改成 `:80`，就只能走 HTTP 了。
> Caddy 给纯 IP 签不了证书。

**裸机部署**（已有 Caddy，不想用容器）：

```bash
export DOMAIN=search.example.com AUTH_USER=kun AUTH_HASH='$2a$14$...'
caddy run --config Caddyfile
```

> 如果你的 Caddy 是 2.7 或更早版本，把 Caddyfile 里的 `basic_auth` 改成 `basicauth`。

### Nginx 反向代理示例（备选）

```nginx
location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

## 功能

**搜索**

- 多上游并发聚合，结果按网盘类型归并、按分享链接跨源去重
- 支持按「TG 频道 / 插件站 / 全部」限定搜索源
- 可指定单个或多个插件、频道进行定向搜索
- 5 分钟结果缓存，重复搜索毫秒返回；可点「刷新」强制绕过缓存
- 上游失败自动重试，单源故障不影响整体结果

**结果处理**

- **同一资源的多个网盘链接自动合并成一张卡**，每个网盘一行，点对应入口直接打开；只有单个网盘的资源保持紧凑卡片
- 可切换「合并 / 列表」两种展示方式
- 按网盘类型分页签，带数量角标（口径跟随视图：合并时算资源数，列表时算链接数）
- 排序：最新发布 / 默认相关度 / 名称
- 关键词高亮、提取码自动识别（含从链接 `?pwd=` 中提取）
- 一键复制分享链接、复制提取码、打开链接
- 分页加载，每页 24 条

**体验**

- 搜索历史（本地保存，可单条删除或清空）
- 快捷键：`/` 聚焦搜索框，`Esc` 关闭面板
- 浅色 / 深色主题，跟随系统并可手动切换
- 响应式布局，移动端可用
- URL 带 `?q=关键词`，可直接分享搜索结果

## 目录结构

```
cloudsearch/
├── server.js                # 零依赖 Node 服务：静态托管 + 聚合代理 + 缓存
├── config.json              # 端口、超时、上游源配置
├── package.json
├── public/                  # 前端（原生 HTML / CSS / JS）
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── Dockerfile               # 容器镜像构建
├── docker-compose.yml       # 一键部署（直接暴露端口）
├── docker-compose.caddy.yml # 带 HTTPS 与密码保护的部署
├── Caddyfile                # Caddy 反代 + Basic Auth 配置
├── start.bat                # Windows 双击启动
└── README.md
```

## 配置

编辑 `config.json`：

```json
{
  "port": 8787,
  "host": "127.0.0.1",
  "cacheTTL": 300,
  "timeout": 45000,
  "retries": 1,
  "upstreams": [
    { "name": "PanSou 主站", "base": "https://pansou.app", "enabled": true },
    { "name": "PanSou 镜像", "base": "https://so.252035.xyz", "enabled": true }
  ]
}
```

| 字段 | 说明 |
| --- | --- |
| `port` / `host` | 监听地址，可被环境变量 `PORT` / `HOST` 覆盖 |
| `cacheTTL` | 同一关键词的结果缓存秒数 |
| `timeout` | 单个上游请求超时（毫秒） |
| `retries` | 上游失败后的重试次数 |
| `upstreams[].base` | 上游根地址，需实现 PanSou 兼容的 `/api/search` 与 `/api/health` |

增加上游只需往 `upstreams` 里追加一项；自建 PanSou 服务也可以填进来。

环境变量优先级高于配置文件：

```bash
HOST=0.0.0.0 PORT=9000 node server.js
```

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/search` | 聚合搜索。body：`{kw, src, plugins, channels, refresh}` |
| GET | `/api/health` | 上游健康状态、可用插件与频道列表 |
| GET | `/api/config` | 当前生效配置 |

返回统一结构：`{ code, message, data: { total, deduped, raw_count, merged_by_type, sources } }`。

## 说明

- 应用本身不存储任何资源，所有结果均来自公开索引上游。
- 浏览器无法直连上游（Cloudflare CORS 限制），因此由本地 Node 服务代为请求，这也是必须通过 `node server.js` 启动的原因。
- 上游均为第三方公开服务，可用性会波动；某个源挂掉时其余源仍会正常返回。
