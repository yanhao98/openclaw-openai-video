import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

interface VideoPluginConfig {
  baseUrl?: string;
  apiKey?: string;
  defaultModel?: string;
  models?: string[];
}

interface VideoSourceAsset {
  url?: string;
  buffer?: Buffer;
  mimeType?: string;
  fileName?: string;
  role?: string;
}

interface VideoGenerationRequest {
  provider: string;
  model: string;
  prompt: string;
  cfg?: {
    plugins?: {
      entries?: Record<string, { config?: VideoPluginConfig }>;
    };
    models?: {
      providers?: Record<string, { baseUrl?: string }>;
    };
  };
  timeoutMs?: number;
  size?: string;
  aspectRatio?: string;
  resolution?: string;
  durationSeconds?: number;
  audio?: boolean;
  watermark?: boolean;
  inputImages?: VideoSourceAsset[];
  providerOptions?: Record<string, unknown>;
}

interface VideoTaskResponse {
  id?: string;
  status?: string;
  error?: unknown;
  video_url?: string;
  url?: string;
  download_url?: string;
  outputs?: Array<{ video_url?: string; url?: string }>;
  [key: string]: unknown;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export default definePluginEntry({
  id: "openai-video",
  name: "OpenAI Compatible Video Provider",
  description: "Standard /v1/videos (POST -> Poll -> GET /content) video provider",

  register(api) {
    api.registerVideoGenerationProvider({
      id: "openai-video",
      label: "OpenAI Video",
      defaultModel: "sora-2",
      models: ["sora-2", "sora", "kling", "wan2.6"],
      capabilities: {
        generate: {
          maxVideos: 1,
          supportsAspectRatio: true,
          supportsResolution: true,
          supportsSize: true,
          aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
          resolutions: ["720P", "1080P"],
        },
        imageToVideo: {
          enabled: true,
          maxVideos: 1,
          maxInputImages: 1,
          supportsAspectRatio: true,
          supportsResolution: true,
        },
        videoToVideo: { enabled: false },
      },

      isConfigured() {
        return true;
      },

      async generateVideo(req: VideoGenerationRequest) {
        const pluginCfg: VideoPluginConfig =
          req.cfg?.plugins?.entries?.["openai-video"]?.config ?? {};
        const openaiCfg = req.cfg?.models?.providers?.openai ?? {};

        const baseUrl = (
          pluginCfg.baseUrl ||
          process.env.OPENAI_VIDEO_BASE_URL ||
          openaiCfg.baseUrl ||
          process.env.OPENAI_BASE_URL ||
          "https://api.openai.com/v1"
        ).replace(/\/+$/, "");

        const apiKey =
          pluginCfg.apiKey ||
          process.env.OPENAI_VIDEO_API_KEY ||
          process.env.BIFROST_API_KEY ||
          process.env.OPENAI_API_KEY;

        const model = req.model?.trim() || pluginCfg.defaultModel || "sora-2";

        if (!apiKey) {
          throw new Error(
            "Missing API key for openai-video. Please configure it in plugin settings or set OPENAI_VIDEO_API_KEY / OPENAI_API_KEY.",
          );
        }

        const headers: Record<string, string> = {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        };

        // 1. Build request body for POST /v1/videos
        const body: Record<string, unknown> = {
          model,
          prompt: req.prompt,
          ...(req.aspectRatio ? { aspect_ratio: req.aspectRatio } : {}),
          ...(req.size ? { size: req.size } : {}),
          ...(req.resolution ? { resolution: req.resolution.toLowerCase() } : {}),
          ...(req.durationSeconds ? { duration: req.durationSeconds } : {}),
          ...req.providerOptions,
        };

        if (req.inputImages && req.inputImages.length > 0) {
          const img = req.inputImages[0];
          body.image =
            img.url ||
            (img.buffer
              ? `data:${img.mimeType || "image/png"};base64,${img.buffer.toString("base64")}`
              : undefined);
        }

        const createRes = await fetch(`${baseUrl}/videos`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });

        if (!createRes.ok) {
          const errText = await createRes.text().catch(() => "");
          throw new Error(`POST ${baseUrl}/videos failed (${createRes.status}): ${errText}`);
        }

        const task = (await createRes.json()) as VideoTaskResponse;
        const videoId = task.id;
        if (!videoId) {
          throw new Error(
            `POST ${baseUrl}/videos response missing task id: ${JSON.stringify(task)}`,
          );
        }

        // 2. Poll GET /v1/videos/{id}
        const deadline = Date.now() + (req.timeoutMs || 600_000);
        let status = task.status;
        let latestTask: VideoTaskResponse = task;

        while (status !== "completed" && status !== "succeeded" && status !== "ready") {
          if (status === "failed" || status === "cancelled" || status === "error") {
            throw new Error(
              `Video task ${videoId} failed with status "${status}": ${JSON.stringify(latestTask.error || latestTask)}`,
            );
          }
          if (Date.now() > deadline) {
            throw new Error(`Video task ${videoId} timed out after waiting`);
          }

          await sleep(5000);

          const pollRes = await fetch(`${baseUrl}/videos/${encodeURIComponent(videoId)}`, {
            headers: { Authorization: `Bearer ${apiKey}` },
          });

          if (!pollRes.ok) {
            const errText = await pollRes.text().catch(() => "");
            throw new Error(
              `GET ${baseUrl}/videos/${videoId} failed (${pollRes.status}): ${errText}`,
            );
          }

          latestTask = (await pollRes.json()) as VideoTaskResponse;
          status = latestTask.status;

          if (status === "failed" || status === "cancelled" || status === "error") {
            throw new Error(
              `Video task ${videoId} failed with status "${status}": ${JSON.stringify(latestTask.error || latestTask)}`,
            );
          }
        }

        // 3. Download generated MP4 video stream
        let videoBuffer: Buffer;
        let mimeType = "video/mp4";

        const contentRes = await fetch(
          `${baseUrl}/videos/${encodeURIComponent(videoId)}/content`,
          {
            headers: { Authorization: `Bearer ${apiKey}` },
          },
        );

        if (contentRes.ok) {
          const arrayBuf = await contentRes.arrayBuffer();
          videoBuffer = Buffer.from(arrayBuf);
          mimeType = contentRes.headers.get("content-type") || "video/mp4";
        } else {
          const fallbackUrl =
            latestTask.video_url ||
            latestTask.url ||
            latestTask.download_url ||
            latestTask.outputs?.[0]?.video_url ||
            latestTask.outputs?.[0]?.url;

          if (fallbackUrl) {
            const urlRes = await fetch(fallbackUrl);
            if (!urlRes.ok) {
              throw new Error(`Failed to download video from ${fallbackUrl} (${urlRes.status})`);
            }
            const arrayBuf = await urlRes.arrayBuffer();
            videoBuffer = Buffer.from(arrayBuf);
            mimeType = urlRes.headers.get("content-type") || "video/mp4";
          } else {
            const errText = await contentRes.text().catch(() => "");
            throw new Error(
              `GET ${baseUrl}/videos/${videoId}/content failed (${contentRes.status}): ${errText}`,
            );
          }
        }

        return {
          model,
          videos: [
            {
              buffer: videoBuffer,
              mimeType,
              fileName: `${videoId}.mp4`,
            },
          ],
          metadata: {
            videoId,
            status,
            ...latestTask,
          },
        };
      },
    });
  },
});
