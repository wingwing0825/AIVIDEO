import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { readFile } from "node:fs/promises";

const preferredPort = Number(process.env.PORT || 4173);
const root = process.cwd();
const maxUploadBytes = Number(process.env.MAX_UPLOAD_MB || 250) * 1024 * 1024;

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm"
};

function safePath(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0] || "/");
  const resolved = normalize(join(root, clean === "/" ? "index.html" : clean));
  return resolved.startsWith(root) ? resolved : null;
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxUploadBytes) {
        reject(new Error(`Upload is larger than ${process.env.MAX_UPLOAD_MB || 250}MB.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseContentDisposition(value = "") {
  const result = {};
  for (const part of value.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawValue.length) continue;
    const key = rawKey.trim();
    const joined = rawValue.join("=").trim();
    result[key] = joined.replace(/^"|"$/g, "");
  }
  return result;
}

function parseMultipart(contentType, body) {
  const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
  if (!boundaryMatch) {
    throw new Error("Missing multipart boundary.");
  }

  const boundary = Buffer.from(`--${boundaryMatch[1].replace(/^"|"$/g, "")}`);
  const fields = {};
  const files = {};
  let cursor = body.indexOf(boundary);

  while (cursor !== -1) {
    cursor += boundary.length;

    if (body[cursor] === 45 && body[cursor + 1] === 45) break;
    if (body[cursor] === 13 && body[cursor + 1] === 10) cursor += 2;

    const nextBoundary = body.indexOf(boundary, cursor);
    if (nextBoundary === -1) break;

    let part = body.subarray(cursor, nextBoundary);
    if (part.length >= 2 && part[part.length - 2] === 13 && part[part.length - 1] === 10) {
      part = part.subarray(0, part.length - 2);
    }

    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd !== -1) {
      const headerText = part.subarray(0, headerEnd).toString("utf8");
      const content = part.subarray(headerEnd + 4);
      const headers = Object.fromEntries(
        headerText.split("\r\n").map((line) => {
          const [name, ...rest] = line.split(":");
          return [name.toLowerCase(), rest.join(":").trim()];
        })
      );
      const disposition = parseContentDisposition(headers["content-disposition"]);

      if (disposition.name) {
        if (disposition.filename) {
          files[disposition.name] = {
            filename: disposition.filename,
            contentType: headers["content-type"] || "application/octet-stream",
            data: content
          };
        } else {
          fields[disposition.name] = content.toString("utf8");
        }
      }
    }

    cursor = nextBoundary;
  }

  return { fields, files };
}

async function uploadToFalStorage(fal, file) {
  if (!file || !file.data.length) return null;
  const uploadFile = new File([file.data], file.filename, { type: file.contentType });
  return fal.storage.upload(uploadFile);
}

async function handleFalSubmit(req, res) {
  try {
    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes("multipart/form-data")) {
      sendJson(res, 415, { error: "Expected multipart/form-data." });
      return;
    }

    let fal;
    try {
      ({ fal } = await import("@fal-ai/client"));
    } catch {
      sendJson(res, 500, {
        error: "Missing @fal-ai/client.",
        fix: "Run npm install before deploying or starting the cloud version."
      });
      return;
    }

    const body = await readRequestBody(req);
    const { fields, files } = parseMultipart(contentType, body);
    const apiKey = fields.apiKey?.trim() || process.env.FAL_KEY;
    const model = fields.model?.trim();
    const prompt = fields.prompt?.trim();

    if (!apiKey) {
      sendJson(res, 400, { error: "Missing fal API key." });
      return;
    }
    if (!model || !prompt) {
      sendJson(res, 400, { error: "Missing model or prompt." });
      return;
    }

    fal.config({ credentials: apiKey });

    const uploaded = {
      video_url: fields.videoUrl?.trim() || await uploadToFalStorage(fal, files.videoFile),
      before_reference_url: await uploadToFalStorage(fal, files.beforeImage),
      after_reference_url: await uploadToFalStorage(fal, files.afterImage),
      mask_url: await uploadToFalStorage(fal, files.maskImage)
    };

    const input = {
      prompt,
      video_url: uploaded.video_url
    };

    if (!input.video_url) {
      sendJson(res, 400, {
        error: "Missing video input.",
        fix: "Upload a video file or paste a public video_url."
      });
      return;
    }

    if (model.includes("grok-imagine")) {
      input.resolution = fields.resolution || "auto";
    }

    const result = await fal.subscribe(model, { input, logs: true });

    sendJson(res, 200, {
      ok: true,
      mode: "subscribe",
      model,
      uploaded,
      submitted_input: input,
      result,
      note: "Files were uploaded to fal storage. The server waited for fal to finish and returned the result when available. If Vercel times out for long videos, use a shorter clip or switch to a background queue flow."
    });
  } catch (error) {
    sendJson(res, 500, {
      error: error.message || "Failed to process fal job."
    });
  }
}

function createAppServer() {
  return createServer(async (req, res) => {
    if (req.url === "/api/submit" && req.method === "POST") {
      await handleFalSubmit(req, res);
      return;
    }

    const filePath = safePath(req.url || "/");

    if (!filePath) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    try {
      const body = await readFile(filePath);
      res.writeHead(200, {
        "content-type": types[extname(filePath).toLowerCase()] || "application/octet-stream",
        "cache-control": "no-store"
      });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
    }
  });
}

function listen(port) {
  const server = createAppServer();

  server.once("error", (error) => {
    if (error.code === "EADDRINUSE") {
      const nextPort = port + 1;
      console.log(`Port ${port} is already in use. Trying http://localhost:${nextPort}`);
      listen(nextPort);
      return;
    }

    throw error;
  });

  server.listen(port, () => {
    console.log(`AI Video Repair Console running at http://localhost:${port}`);
  });
}

listen(preferredPort);

