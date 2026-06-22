# Vortexa Python Plan 部署说明

这个目录只服务于 Vortexa Python 容器部署，不影响项目原本的 Docker、Hugging Face、服务器 compose 部署。

## 部署模型

Vortexa 的 Python Plan 主入口是 `app.py`，但它不会自动帮你解压上传的业务压缩包。因此这里采用三文件方案：

```text
app.py
requirements.txt
payload.zip
```

- `app.py`：Vortexa 启动入口，负责解压 `payload.zip` 并启动 FastAPI。
- `requirements.txt`：Vortexa 启动前安装 Python 依赖。
- `payload.zip`：项目后端源码和 `web/out` 静态前端产物。

启动后，`app.py` 会把 `payload.zip` 解压到：

```text
/home/container/.vortexa_runtime/app
```

然后从那里加载真正的 `main.py`。

## 本地生成

在项目根目录运行：

```powershell
.\vortexa\package.ps1
```

脚本会先执行前端构建，再生成上传文件：

```text
vortexa/dist/app.py
vortexa/dist/requirements.txt
vortexa/dist/payload.zip
vortexa/dist/python-packages.txt
vortexa/dist/auth-key.example.txt
vortexa/dist/config.example.json
```

如果你确认 `web/out` 已经是最新的，可以跳过前端构建：

```powershell
.\vortexa\package.ps1 -SkipBuild
```

## Vortexa 设置

在 Vortexa 面板里建议这样填：

```text
Docker Image: ghcr.io/parkervcp/yolks:python_3.12
User Uploaded Files: 开启
Git Repo Address: 留空
Auto Update: 关闭
App py file / PY_FILE: app.py
Requirements file / REQUIREMENTS_FILE: requirements.txt
```

如果 `Additional Python packages` 可用，可以把 `vortexa/dist/python-packages.txt` 里的整行内容复制进去。正常情况下 `requirements.txt` 已经够用，这一项只是兜底。

## 上传文件

把下面三个文件上传到 `/home/container` 一级目录：

```text
vortexa/dist/app.py
vortexa/dist/requirements.txt
vortexa/dist/payload.zip
```

上传后远端目录应该直接长这样：

```text
/home/container/app.py
/home/container/requirements.txt
/home/container/payload.zip
```

不要放到子目录，也不要指望 Vortexa 自动解压 `payload.zip`。

## 登录密钥

当前 Vortexa 入口默认兜底登录密钥是：

```text
a123456789
```

公网使用强烈建议改成强密钥。覆盖方式任选一种：

```text
CHATGPT2API_AUTH_KEY=你的强密钥
```

或者上传 `/home/container/auth-key.txt`：

```text
你的强密钥
```

也可以上传 `/home/container/config.json`：

```json
{
  "auth-key": "你的强密钥"
}
```

优先级是：

```text
CHATGPT2API_AUTH_KEY > auth-key.txt > 默认 a123456789
```

## 访问方式

Vortexa 当前会给一个外部端口，例如日志里：

```text
Uvicorn running on http://0.0.0.0:25807
```

访问时要带这个端口：

```text
http://服务器IP:25807/
http://你的域名:25807/
```

如果使用 Cloudflare DNS，保持灰云 `DNS only`。`25807` 不是 Cloudflare 橙云代理支持的 HTTP 端口，开橙云容易失败。

## 重新部署

每次代码或前端改动后：

1. 本地运行 `.\vortexa\package.ps1`。
2. 上传覆盖 `app.py`、`requirements.txt`、`payload.zip`。
3. 重启 Vortexa 服务。

如果只改了 `vortexa/app.py`，也建议重新运行脚本并至少覆盖远端 `app.py`，避免版本不一致。

## 本地临时目录

这些目录都是生成或测试产物，不需要提交：

```text
vortexa/dist/
vortexa/.package/
vortexa/.smoke*/
```

其中 `vortexa/dist/` 是本地生成的上传文件目录，可以保留在本机，但已经被 `.gitignore` 忽略。
