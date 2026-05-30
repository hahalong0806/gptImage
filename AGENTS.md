# AGENTS.md

本文件给 Codex、Claude、Cursor 等 AI 编码助手使用。处理本项目时优先遵守这里的约定，再结合代码和 README 判断。

## 语言与沟通

- 后续所有回答使用简体中文。
- 代码、命令、日志、报错原文保持原样，不要强行翻译。
- 说明问题时先给结论，再给必要原因和可执行命令。
- 不要假设服务器状态，遇到部署问题先看 `docker compose ps`、`docker logs chatgpt2api --tail=100`、`curl -i http://127.0.0.1:3010/`。

## 项目概览

- 后端：FastAPI / uvicorn。
- 前端：Next.js，`output: 'export'` 静态导出。
- 生产镜像构建时会先构建前端，然后把 `web/out` 复制为后端服务的 `web_dist`。
- 生产环境只有一个 uvicorn 服务端口，FastAPI 同时服务 API 和前端静态页面。
- Docker 容器内默认监听 `80`。
- 容器持久化数据目录是 `/app/data`。

## 关键部署约定

- 服务器域名：`gpt.kesen.eu.org`。
- Caddy 反代目标：`127.0.0.1:3010`。
- Docker 端口映射：`127.0.0.1:3010:80`。
- 推荐镜像：`ghcr.io/hahalong0806/gptimage:latest`。
- 不要改回 `ghcr.io/basketikun/chatgpt2api:latest`，否则会丢失 fork 中新增的功能。
- 不要把容器端口改回 `7860`，除非同步修改服务器 compose 和文档。
- 服务器配置较低，不推荐在服务器上 build；推荐 GitHub Actions 构建镜像，服务器只 pull 镜像。

当前 `docker-compose.yml` 应保持类似：

```yaml
services:
  app:
    image: ghcr.io/hahalong0806/gptimage:latest
    container_name: chatgpt2api
    restart: unless-stopped
    ports:
      - "127.0.0.1:3010:80"
    volumes:
      - ./data:/app/data
    environment:
      - STORAGE_BACKEND=json
      - CHATGPT2API_AUTH_KEY=your_secret_key
      - CHATGPT2API_BASE_URL=https://gpt.kesen.eu.org
```

## 镜像构建与发布

- GitHub Actions 文件：`.github/workflows/docker-build.yml`。
- 推送到 `main` 会构建并推送：
  - `ghcr.io/hahalong0806/gptimage:latest`
  - sha tag
- 构建平台：`linux/amd64,linux/arm64`。
- GHCR 镜像名必须小写，当前固定为 `hahalong0806/gptimage`。
- 如果服务器 `docker compose pull` 失败，优先检查 GHCR package 是否 public，或服务器是否已 `docker login ghcr.io -u hahalong0806`。

服务器更新推荐流程：

```bash
cd /var/gptImage
git pull
docker compose pull
docker compose up -d
docker logs chatgpt2api --tail=100
```

正常日志应包含：

```text
Uvicorn running on http://0.0.0.0:80
```

## 本地开发与验证

前端构建检查：

```bash
cd web
npm run build
```

注意：本项目根目录和 `web/` 下都可能存在 lockfile，`npm run build` 可能出现 Next.js workspace root warning。只要构建成功即可，不要为这个 warning 做无关重构。

后端本地开发：

```bash
uv sync
uv run main.py
```

前端本地开发：

```bash
cd web
bun install
bun run dev
```

## 端口排障

Caddy 502 时，不要先改代码，先在服务器检查：

```bash
cd /var/gptImage
docker compose ps
docker logs chatgpt2api --tail=100
curl -i http://127.0.0.1:3010/
docker compose config
```

判断标准：

- `docker compose ps` 应显示 `127.0.0.1:3010->80/tcp`。
- `docker logs` 应显示 uvicorn 监听 `0.0.0.0:80`。
- `curl http://127.0.0.1:3010/` 应返回页面或重定向，不应 connection reset/refused。

历史坑：

- 远程上游镜像曾经实际监听容器内 `80`，但旧源码/文档写过 `7860`。
- 当前 fork 已统一到容器内 `80`，服务器无需改 Caddy。
- 如果把 compose 改成源码 build，弱服务器会很慢，也容易因为端口/缓存误判问题。

## 数据与存储

- Docker 数据挂载：`./data:/app/data`。
- 默认存储后端：`STORAGE_BACKEND=json`。
- SQLite 示例路径：`sqlite:////app/data/accounts.db`。
- 管理员登录密钥通过 `CHATGPT2API_AUTH_KEY` 或 `/app/data/config.json` 提供；公网部署不要使用默认密钥。
- 镜像默认 `CHATGPT2API_AUTH_KEY=a123456789` 仅作为兜底，不应在公网使用。

## 图片存储与 IndexedDB

项目里有两类图片数据，不能混淆：

- 后端托管图片：本机 `/app/data/images`、缩略图、图片索引、WebDAV。
- 浏览器 IndexedDB 图片历史：前端 `localforage`，数据库名 `chatgpt2api`，storeName `image_conversations`。

图片管理页面用于管理后端托管图片。已按用户要求增加联动：

- 图片管理页删除单张图片时，会同步清理当前浏览器 IndexedDB 里匹配的图片结果。
- 图片管理页删除所选/删除匹配日期时，也会同步清理当前浏览器 IndexedDB 中对应结果。
- 这个联动只能清理当前浏览器。IndexedDB 是浏览器本地数据，服务器无法直接删除其他设备或其他浏览器中的 IndexedDB。

如果后续要让“其他管理员浏览器下次打开自动清理 IndexedDB”，需要新增服务端清理版本号/时间戳，前端启动时比对后执行本地清理。

## 前端 IndexedDB 相关文件

- `web/src/store/image-conversations.ts`
  - `listImageConversations`
  - `saveImageConversation`
  - `clearImageConversations`
  - `deleteImagesFromConversations`
- `web/src/app/image/page.tsx`
  - 图片生成页历史记录。
- `web/src/app/image-manager/page.tsx`
  - 图片管理页，删除后联动 IndexedDB 清理。

## 修改规范

- 优先遵循现有代码风格，不做无关重构。
- 手动编辑文件时使用 `apply_patch`。
- 改前端页面、状态逻辑、Dockerfile、compose、Actions 后，优先跑相关验证。
- 前端改动至少跑：

```bash
cd web
npm run build
```

- 不要随意删除 `data/`，它可能包含账号、配置、图片、日志和任务数据。
- 清理 Docker 构建缓存可建议用户使用 `docker builder prune`，不要默认建议 `docker system prune -a --volumes`。

## 用户已明确提出的偏好

- 使用简体中文沟通。
- 服务器不要频繁本机 build，优先使用 GitHub Actions 构建好的镜像。
- 不想再修改服务器 Caddy/端口配置，代码和镜像应适配当前服务器：
  - Caddy -> `127.0.0.1:3010`
  - Docker -> `127.0.0.1:3010:80`
- 图片管理中的清理行为应尽量符合当前保存方式的直觉；当前已实现删除后同步清理当前浏览器 IndexedDB。
- 多人可能共用管理员账号，因此不要只考虑单人使用场景。
