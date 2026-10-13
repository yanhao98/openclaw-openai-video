# OpenClaw OpenAI Video Provider Plugin (`openai-video`)

OpenClaw 视频生成插件，适配标准 **OpenAI Videos API**（Sora API 协议规范）：
* `POST /v1/videos` 创建生成任务
* `GET /v1/videos/{id}` 轮询任务完成状态
* `GET /v1/videos/{id}/content` 下载 MP4 二进制视频流（同时兼容输出对象内带 `url` / `video_url` 的回退下载）

支持文生视频、图生视频（带参考图）、自定义比例、分辨率（720P / 1080P）及生成时长。

---

## 快速安装

在安装了 OpenClaw 的终端中运行：

```bash
openclaw plugins install git:github.com/yanhao98/openclaw-openai-video --force
```

---

## 配置说明

插件支持通过 **Web 控制台（Control UI）** 或直接编辑配置文件 `openclaw.json`。

### 方式 1：Web 控制台可视化配置
打开 OpenClaw Web 界面，进入 **Settings → Plugins → OpenAI Compatible Video Provider**：
* **API Base URL**：填写你的渠道端点（例如 `https://api.example.com/v1` 或内部反代地址）
* **API Key**：填写你的 API Key（留空则自动读取环境变量 `OPENAI_VIDEO_API_KEY`、`BIFROST_API_KEY` 或 `OPENAI_API_KEY`）
* **默认视频模型**：例如 `sora-2` 或 `kling`

### 方式 2：编辑 `openclaw.json`

在 `~/.openclaw/openclaw.json` 中添加配置：

```json
{
  "plugins": {
    "entries": {
      "openai-video": {
        "enabled": true,
        "config": {
          "baseUrl": "https://api.your-channel.com/v1",
          "apiKey": "sk-your-api-key",
          "defaultModel": "sora-2"
        }
      }
    }
  },
  "agents": {
    "defaults": {
      "mediaModels": {
        "video": {
          "primary": "openai-video/sora-2"
        }
      }
    }
  }
}
```

配置完成后，执行插件重载：
```bash
openclaw plugins reload openai-video
```

---

## 使用方法

配置后，OpenClaw 内置的 `video_generate` 工具即可自动使用该 Provider：

* **自然语言直接对话生成**：
  > “帮我生成一个 5 秒的猫咪在海滩上奔跑的 16:9 视频”
* **垫图/图生视频**：
  在对话中上传或提供图片链接，提示助手基于该图生成视频。

---

## 插件更新

如需更新到最新版本，在终端执行：

```bash
openclaw plugins update openai-video
```

---

## License

[MIT](LICENSE)
