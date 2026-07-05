import { fal } from "@fal-ai/client";

export const config = {
  api: {
    bodyParser: false
  }
};

const maxUploadBytes = Number(process.env.MAX_UPLOAD_MB || 100) * 1024 * 1024;

function sendJson(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data, null, 2));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxUploadBytes) {
        reject(new Error(`Upload is larger than ${process.env.MAX_UPLOAD_MB || 100}MB.`));
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
    result[rawKey.trim()] = rawValue.join("=").trim().replace(/^"|"$/g, "");
  }
  return result;
}

function parseMultipart(contentType, body) {
  const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
  if (!boundaryMatch) throw new Error("Missing multipart boundary.");

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

async function uploadToFalStorage(file) {
  if (!file || !file.data.length) return null;
  const uploadFile = new File([file.data], file.filename, { type: file.contentType });
  return fal.storage.upload(uploadFile);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed." });
    return;
  }

  try {
    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes("multipart/form-data")) {
      sendJson(res, 415, { error: "Expected multipart/form-data." });
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
      video_url: fields.videoUrl?.trim() || await uploadToFalStorage(files.videoFile),
      before_reference_url: await uploadToFalStorage(files.beforeImage),
      after_reference_url: await uploadToFalStorage(files.afterImage),
      mask_url: await uploadToFalStorage(files.maskImage)
    };

    if (!uploaded.video_url) {
      sendJson(res, 400, {
        error: "Missing video input.",
        fix: "Upload a video file or paste a public video_url."
      });
      return;
    }

    const input = {
      prompt,
      video_url: uploaded.video_url
    };

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

