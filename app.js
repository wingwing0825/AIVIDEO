const models = [
  {
    id: "fal-ai/kling-video/o1/video-to-video/edit",
    name: "Kling Video O1 Edit",
    tag: "可讀參考圖",
    note: "官方支援 video_url + image_urls。適合用原片加 before/after/紅色標記截圖做影片修復測試。",
    limits: "Input: prompt + video_url + image_urls + keep_audio"
  },
  {
    id: "bytedance/seedance-2.0/reference-to-video",
    name: "Seedance 2.0 Reference To Video",
    tag: "多模態參考",
    note: "官方支援最多 9 張圖、3 條影片、3 段音訊作 reference。較像重新生成參考影片，不一定保留原片逐格結構。",
    limits: "Input: prompt + image_urls + video_urls + audio_urls"
  },
  {
    id: "google/gemini-omni-flash/edit",
    name: "Gemini Omni Flash Edit",
    tag: "只讀文字+影片",
    note: "官方 schema 只支援 prompt + video_url；不會正式讀取 before/after/mask 圖。",
    limits: "Input: prompt + video_url"
  },
  {
    id: "xai/grok-imagine-video/edit-video",
    name: "Grok Imagine Edit Video",
    tag: "只讀文字+影片",
    note: "官方 schema 只支援 prompt + video_url + resolution；不會正式讀取 before/after/mask 圖。",
    limits: "Input: prompt + video_url + resolution"
  }
];
const state = {
  selectedModel: models[0].id,
  maskImage: null,
  maskStrokes: [],
  isDrawing: false,
  currentStroke: null
};

const modelSchemas = {
  "fal-ai/kling-video/o1/video-to-video/edit": {
    officialInputs: ["prompt", "video_url", "keep_audio", "image_urls", "elements"],
    supportsVisualGuides: true,
    visualGuideField: "image_urls",
    maxGuideImages: 4,
    note: "fal 官方 schema 支援 image_urls；before/after/紅色標記截圖會正式放入模型 input。沒有硬 mask_url 欄位，紅色標記會以參考圖方式讀取。"
  },
  "bytedance/seedance-2.0/reference-to-video": {
    officialInputs: ["prompt", "image_urls", "video_urls", "audio_urls", "resolution", "duration", "aspect_ratio", "generate_audio"],
    supportsVisualGuides: true,
    visualGuideField: "image_urls",
    maxGuideImages: 9,
    usesVideoUrlsArray: true,
    note: "fal 官方 schema 支援 image_urls 和 video_urls；較像 reference-to-video 重新生成，不是精準逐格修片。"
  },
  "google/gemini-omni-flash/edit": {
    officialInputs: ["prompt", "video_url"],
    supportsVisualGuides: false,
    note: "fal 官方 schema 只列 prompt + video_url；before/after/mask 不會作為正式模型 input。"
  },
  "xai/grok-imagine-video/edit-video": {
    officialInputs: ["prompt", "video_url", "resolution"],
    supportsVisualGuides: false,
    note: "fal 官方 schema 只列 prompt + video_url + resolution；before/after/mask 不會作為正式模型 input。"
  }
};

const els = {
  apiKey: document.querySelector("#apiKey"),
  toggleKey: document.querySelector("#toggleKey"),
  modelGrid: document.querySelector("#modelGrid"),
  videoFile: document.querySelector("#videoFile"),
  videoFileName: document.querySelector("#videoFileName"),
  videoUrl: document.querySelector("#videoUrl"),
  videoPreview: document.querySelector("#videoPreview"),
  videoEmpty: document.querySelector("#videoEmpty"),
  beforeImage: document.querySelector("#beforeImage"),
  beforeFileName: document.querySelector("#beforeFileName"),
  afterImage: document.querySelector("#afterImage"),
  afterFileName: document.querySelector("#afterFileName"),
  beforePreview: document.querySelector("#beforePreview"),
  afterPreview: document.querySelector("#afterPreview"),
  maskImage: document.querySelector("#maskImage"),
  maskFileName: document.querySelector("#maskFileName"),
  maskCanvas: document.querySelector("#maskCanvas"),
  maskEmpty: document.querySelector("#maskEmpty"),
  brushSize: document.querySelector("#brushSize"),
  undoMask: document.querySelector("#undoMask"),
  clearMask: document.querySelector("#clearMask"),
  downloadMask: document.querySelector("#downloadMask"),
  promptOutput: document.querySelector("#promptOutput"),
  jsonOutput: document.querySelector("#jsonOutput"),
  copyPrompt: document.querySelector("#copyPrompt"),
  copyJson: document.querySelector("#copyJson"),
  downloadSpec: document.querySelector("#downloadSpec"),
  submitFalJob: document.querySelector("#submitFalJob"),
  compatWarning: document.querySelector("#compatWarning"),
  cloudStatus: document.querySelector("#cloudStatus"),
  resultVideoUrl: document.querySelector("#resultVideoUrl"),
  resultVideoPreview: document.querySelector("#resultVideoPreview"),
  resultVideoEmpty: document.querySelector("#resultVideoEmpty"),
  loadResultVideo: document.querySelector("#loadResultVideo"),
  downloadResultVideo: document.querySelector("#downloadResultVideo"),
  toast: document.querySelector("#toast")
};

const inputIds = [
  "apiKey",
  "lockColor",
  "useFullVideo",
  "maskedOnly",
  "preserveIdentity",
  "noCrop",
  "noAudio",
  "defectText",
  "extraText",
  "videoUrl",
  "resultVideoUrl"
];

const ctx = els.maskCanvas.getContext("2d");

function renderModels() {
  els.modelGrid.innerHTML = models.map((model, index) => `
    <label class="model-card">
      <input type="radio" name="model" value="${model.id}" ${index === 0 ? "checked" : ""} />
      <span class="model-title">${model.name}<span class="tag">${model.tag}</span></span>
      <span class="model-id">${model.id}</span>
      <p>${model.note}</p>
      <p>${model.limits}</p>
    </label>
  `).join("");

  els.modelGrid.addEventListener("change", (event) => {
    if (event.target.name === "model") {
      state.selectedModel = event.target.value;
      updateOutputs();
    }
  });
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove("show"), 2200);
}

function selectedFile(input) {
  return input.files && input.files.length ? input.files[0] : null;
}

function setFileName(target, file, fallback) {
  target.textContent = file ? `${file.name} (${formatBytes(file.size)})` : fallback;
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function fileToObjectUrl(input, callback) {
  const file = selectedFile(input);
  if (!file) return;
  callback(URL.createObjectURL(file), file);
}

function handleVideoUpload() {
  fileToObjectUrl(els.videoFile, (url, file) => {
    els.videoPreview.src = url;
    els.videoEmpty.hidden = true;
    setFileName(els.videoFileName, file, "未選擇影片");
    if (file.size > 4 * 1024 * 1024) {
      showToast("影片已載入。提醒：Vercel 可能擋住較大的影片上傳。");
    } else {
      showToast("影片已載入預覽。");
    }
    updateOutputs();
  });
}

function handleReferenceUpload(input, img, fileNameEl, fallback) {
  fileToObjectUrl(input, (url, file) => {
    img.src = url;
    img.parentElement.classList.add("has-image");
    setFileName(fileNameEl, file, fallback);
    updateOutputs();
  });
}

function fitCanvasToImage(image) {
  const maxWidth = 1200;
  const width = Math.min(maxWidth, image.naturalWidth || 900);
  const height = Math.round(width / ((image.naturalWidth || 16) / (image.naturalHeight || 9)));
  els.maskCanvas.width = width;
  els.maskCanvas.height = height;
}

function redrawMask() {
  ctx.clearRect(0, 0, els.maskCanvas.width, els.maskCanvas.height);

  if (state.maskImage) {
    ctx.drawImage(state.maskImage, 0, 0, els.maskCanvas.width, els.maskCanvas.height);
  } else {
    ctx.fillStyle = "#0b1426";
    ctx.fillRect(0, 0, els.maskCanvas.width, els.maskCanvas.height);
  }

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(255, 0, 0, 0.5)";

  for (const stroke of state.maskStrokes) {
    if (stroke.points.length < 2) continue;
    ctx.lineWidth = stroke.size;
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (const point of stroke.points.slice(1)) {
      ctx.lineTo(point.x, point.y);
    }
    ctx.stroke();
  }

  updateOutputs();
}

function loadMaskImage() {
  const file = selectedFile(els.maskImage);
  if (!file) return;

  const img = new Image();
  img.onload = () => {
    fitCanvasToImage(img);
    state.maskImage = img;
    state.maskStrokes = [];
    els.maskEmpty.hidden = true;
    setFileName(els.maskFileName, file, "未選擇截圖");
    redrawMask();
    showToast("瑕疵截圖已載入，可以開始畫 mask。");
  };
  img.src = URL.createObjectURL(file);
}

function canvasPoint(event) {
  const rect = els.maskCanvas.getBoundingClientRect();
  const client = event.touches?.[0] || event;
  return {
    x: ((client.clientX - rect.left) / rect.width) * els.maskCanvas.width,
    y: ((client.clientY - rect.top) / rect.height) * els.maskCanvas.height
  };
}

function startStroke(event) {
  if (!state.maskImage) {
    showToast("請先上傳瑕疵截圖。");
    return;
  }
  event.preventDefault();
  state.isDrawing = true;
  state.currentStroke = {
    size: Number(els.brushSize.value),
    points: [canvasPoint(event)]
  };
  state.maskStrokes.push(state.currentStroke);
  redrawMask();
}

function moveStroke(event) {
  if (!state.isDrawing || !state.currentStroke) return;
  event.preventDefault();
  state.currentStroke.points.push(canvasPoint(event));
  redrawMask();
}

function endStroke() {
  state.isDrawing = false;
  state.currentStroke = null;
}

function getChecked(id) {
  return document.querySelector(`#${id}`).checked;
}

function currentModel() {
  return models.find((item) => item.id === state.selectedModel) || models[0];
}

function schemaFor(model) {
  return modelSchemas[model.id] || {
    officialInputs: ["unknown"],
    supportsVisualGuides: false,
    note: "此模型的最新 fal schema 未在本工具內確認；為免誤導，會當作不支援 before/after/mask 正式 input。"
  };
}

function hasVisualGuides() {
  return Boolean(
    selectedFile(els.beforeImage) ||
    selectedFile(els.afterImage) ||
    selectedFile(els.maskImage) ||
    state.maskStrokes.length
  );
}

function visualGuideSummary() {
  const items = [];
  if (selectedFile(els.beforeImage)) items.push("執前圖");
  if (selectedFile(els.afterImage)) items.push("執後圖");
  if (selectedFile(els.maskImage)) items.push("瑕疵截圖");
  if (state.maskStrokes.length) items.push(`紅色 mask 筆劃 ${state.maskStrokes.length} 個`);
  return items;
}

function updateCompatibilityWarning() {
  if (!els.compatWarning) return;
  const model = currentModel();
  const schema = schemaFor(model);
  const guides = visualGuideSummary();
  const shouldWarn = guides.length && !schema.supportsVisualGuides;
  els.compatWarning.hidden = !shouldWarn;
  els.compatWarning.textContent = shouldWarn
    ? `注意：${model.name} 實際 fal input 只會使用 ${schema.officialInputs.join(" + ")}。你已選的 ${guides.join("、")} 會上傳作記錄，但此模型不會正式讀取它們。`
    : "";
}

function guideImageUrls(uploaded, maxCount = 4) {
  return [
    uploaded.before_reference_url,
    uploaded.after_reference_url,
    uploaded.marked_defect_frame_url || uploaded.defect_frame_url,
    uploaded.mask_url
  ].filter(Boolean).slice(0, maxCount);
}

function buildSubmittedInput(model, prompt, uploaded) {
  const schema = schemaFor(model);
  const imageUrls = guideImageUrls(uploaded, schema.maxGuideImages || 4);
  const input = { prompt };

  if (schema.usesVideoUrlsArray) {
    input.video_urls = uploaded.video_url ? [uploaded.video_url] : [];
    input.image_urls = imageUrls;
    input.resolution = "720p";
    input.duration = "auto";
    input.aspect_ratio = "auto";
    input.generate_audio = false;
  } else {
    input.video_url = uploaded.video_url;
    if (schema.supportsVisualGuides && imageUrls.length) input.image_urls = imageUrls;
    if (schema.supportsVisualGuides) input.keep_audio = getChecked("noAudio") ? false : true;
  }

  if (model.id.includes("grok-imagine")) {
    input.resolution = "auto";
  }

  return input;
}

function uploadedButNotModelInput(uploaded) {
  return {
    before_reference_url: uploaded.before_reference_url || null,
    after_reference_url: uploaded.after_reference_url || null,
    defect_frame_url: uploaded.defect_frame_url || null,
    marked_defect_frame_url: uploaded.marked_defect_frame_url || null,
    mask_url: uploaded.mask_url || null,
    reason: "目前選擇的 fal video edit 模型 schema 沒有 before/after/mask 欄位，所以這些 URL 不會放入正式模型 input。"
  };
}

function buildPrompt() {
  const defect = document.querySelector("#defectText").value.trim();
  const extra = document.querySelector("#extraText").value.trim();
  const schema = schemaFor(currentModel());
  const rules = [];

  if (defect) rules.push(`Repair only this described defect: ${defect}`);
  if (extra) rules.push(`Additional repair direction: ${extra}`);
  if (getChecked("maskedOnly")) {
    if (schema.supportsVisualGuides && state.maskStrokes.length) {
      rules.push("Use the uploaded reference images: @Image1 is the before/defect reference, @Image2 is the desired after direction, and @Image3 is the defect screenshot with red marks. Treat the red marks as the only intended repair regions. Everything outside those regions must remain visually and temporally unchanged.");
    } else {
      rules.push("Make the smallest possible localized repair based only on the written defect description. Do not alter unrelated areas.");
    }
  }
  if (getChecked("lockColor")) {
    rules.push("Do not change the color grade, LUT, white balance, contrast, saturation, exposure, shadows, highlights, or overall lighting.");
  }
  if (getChecked("useFullVideo")) {
    rules.push("Use the full video as temporal context. Preserve original timing, motion continuity, camera movement, frame order, and duration.");
  }
  if (getChecked("preserveIdentity")) {
    rules.push("Preserve all identities, face structure, hands, body shape, logos, readable text, clothing, materials, and background details.");
  }
  if (getChecked("noCrop")) {
    rules.push("Do not crop, zoom, reframe, rotate, stabilize, change lens perspective, or alter the camera position.");
  }
  if (getChecked("noAudio")) {
    rules.push("Do not edit, regenerate, or replace audio.");
  }

  if (schema.supportsVisualGuides && hasVisualGuides()) {
    rules.push("Read all provided @Image references carefully. @Image1 shows the unwanted defect, @Image2 shows the intended repair direction, and @Image3/@Image4 may show marked defect locations.");
  }
  rules.push("The repair must look natural, invisible, frame-consistent, and limited to defect cleanup only.");

  return [
    schema.usesVideoUrlsArray ? "Task: generate a repaired reference video from @Video1 and the supplied image references." : "Task: video defect repair and invisible retouching.",
    ...rules,
    "This is not style transfer. Do not beautify, redesign, relight, recolor, or reinterpret the shot. Keep everything else the same."
  ].join("\n");
}

function maskedKey() {
  const key = els.apiKey.value.trim();
  if (!key) return "PASTE_FAL_KEY_HERE";
  return `${"*".repeat(Math.min(12, key.length))}${key.length > 12 ? ` (${key.length} chars)` : ""}`;
}

function buildJson(prompt) {
  const model = currentModel();
  const schema = schemaFor(model);
  const videoUrl = els.videoUrl.value.trim();
  const resultUrl = els.resultVideoUrl.value.trim();
  const payload = {
    fal_api_key_display: maskedKey(),
    endpoint: `https://queue.fal.run/${model.id}`,
    model: model.id,
    model_schema: {
      official_inputs_used_by_this_tool: schema.officialInputs,
      supports_before_after_mask_as_formal_input: schema.supportsVisualGuides,
      note: schema.note
    },
    headers_preview: {
      Authorization: `Key ${maskedKey()}`
    },
    input_sent_to_fal_preview: schema.usesVideoUrlsArray ? {
      prompt,
      video_urls: [videoUrl || "UPLOADED_VIDEO_URL_FROM_FAL_STORAGE"],
      image_urls: schema.supportsVisualGuides ? ["@Image1 before_reference_url", "@Image2 after_reference_url", "@Image3 marked_defect_frame_url", "@Image4 mask_url"].slice(0, schema.maxGuideImages || 4) : [],
      resolution: "720p",
      duration: "auto",
      aspect_ratio: "auto",
      generate_audio: false
    } : {
      prompt,
      video_url: videoUrl || "UPLOADED_VIDEO_URL_FROM_FAL_STORAGE",
      image_urls: schema.supportsVisualGuides ? ["@Image1 before_reference_url", "@Image2 after_reference_url", "@Image3 marked_defect_frame_url", "@Image4 mask_url"].slice(0, schema.maxGuideImages || 4) : undefined,
      keep_audio: schema.supportsVisualGuides ? !getChecked("noAudio") : undefined
    },
    uploaded_but_not_model_input_preview: {
      video_file_selected: Boolean(selectedFile(els.videoFile)),
      video_file_name: selectedFile(els.videoFile)?.name || null,
      before_reference_selected: Boolean(selectedFile(els.beforeImage)),
      before_reference_name: selectedFile(els.beforeImage)?.name || null,
      after_reference_selected: Boolean(selectedFile(els.afterImage)),
      after_reference_name: selectedFile(els.afterImage)?.name || null,
      mask_image_selected: Boolean(selectedFile(els.maskImage)),
      mask_image_name: selectedFile(els.maskImage)?.name || null,
      mask_stroke_count: state.maskStrokes.length,
      note: schema.supportsVisualGuides ? "此模型可正式使用視覺參考欄位。" : "這些檔案只會上傳到 fal storage 方便核對；目前選擇的模型不會正式讀取 before/after/mask 欄位。"
    },
    safety_rules: {
      preserve_color_grade: getChecked("lockColor"),
      use_full_video_context: getChecked("useFullVideo"),
      masked_region_only: getChecked("maskedOnly"),
      preserve_identity_and_text: getChecked("preserveIdentity"),
      preserve_framing: getChecked("noCrop"),
      video_only_no_audio_edit: getChecked("noAudio")
    },
    result_video_url: resultUrl || null
  };

  if (model.id.includes("grok-imagine")) {
    payload.input_sent_to_fal_preview.resolution = "auto";
  }

  return JSON.stringify(payload, null, 2);
}

function updateOutputs() {
  const prompt = buildPrompt();
  els.promptOutput.value = prompt;
  els.jsonOutput.value = buildJson(prompt);
  updateCompatibilityWarning();
}

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`${label} 已複製。`);
  } catch {
    showToast("複製失敗，請手動選取文字。");
  }
}

function downloadText(filename, text, type = "application/json") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function drawMaskOnly(canvas) {
  const exportCtx = canvas.getContext("2d");
  exportCtx.clearRect(0, 0, canvas.width, canvas.height);
  exportCtx.lineCap = "round";
  exportCtx.lineJoin = "round";
  exportCtx.strokeStyle = "rgba(255, 0, 0, 0.5)";

  for (const stroke of state.maskStrokes) {
    if (stroke.points.length < 2) continue;
    exportCtx.lineWidth = stroke.size;
    exportCtx.beginPath();
    exportCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (const point of stroke.points.slice(1)) {
      exportCtx.lineTo(point.x, point.y);
    }
    exportCtx.stroke();
  }
}

function downloadMask() {
  if (!state.maskImage) {
    showToast("請先上傳並標記瑕疵截圖。");
    return;
  }
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = els.maskCanvas.width;
  exportCanvas.height = els.maskCanvas.height;
  drawMaskOnly(exportCanvas);

  exportCanvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "repair-mask.png";
    link.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}

function appendFile(formData, fieldName, input) {
  const file = selectedFile(input);
  if (file) formData.append(fieldName, file, file.name);
}

function findVideoUrl(value) {
  if (!value) return null;
  if (typeof value === "string") {
    return /^https?:\/\//i.test(value) && /\.(mp4|webm|mov)(\?|#|$)/i.test(value) ? value : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findVideoUrl(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "object") {
    for (const key of ["url", "video_url", "file_url"]) {
      const found = findVideoUrl(value[key]);
      if (found) return found;
    }
    for (const item of Object.values(value)) {
      const found = findVideoUrl(item);
      if (found) return found;
    }
  }
  return null;
}
let falClientPromise = null;

async function loadFalClient() {
  if (!falClientPromise) {
    falClientPromise = import("https://esm.sh/@fal-ai/client@1.6.2");
  }
  const mod = await falClientPromise;
  return mod.fal;
}

function statusLine(message) {
  els.cloudStatus.value += `${message}\n`;
  els.cloudStatus.scrollTop = els.cloudStatus.scrollHeight;
}

async function uploadDirectToFal(fal, label, file) {
  if (!file) return null;
  statusLine(`上傳 ${label}: ${file.name || "file"} (${formatBytes(file.size || 0)})`);
  const url = await fal.storage.upload(file);
  statusLine(`${label} 已上傳: ${url}`);
  return url;
}

async function getMaskFileIfAny() {
  if (!state.maskImage || !state.maskStrokes.length) return null;
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = els.maskCanvas.width;
  exportCanvas.height = els.maskCanvas.height;
  drawMaskOnly(exportCanvas);
  const blob = await new Promise((resolve) => exportCanvas.toBlob(resolve, "image/png"));
  if (!blob) return null;
  return new File([blob], "repair-mask.png", { type: "image/png" });
}

async function getMarkedFrameFileIfAny() {
  if (!state.maskImage || !state.maskStrokes.length) return null;
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = els.maskCanvas.width;
  exportCanvas.height = els.maskCanvas.height;
  const exportCtx = exportCanvas.getContext("2d");
  exportCtx.drawImage(state.maskImage, 0, 0, exportCanvas.width, exportCanvas.height);
  exportCtx.lineCap = "round";
  exportCtx.lineJoin = "round";
  exportCtx.strokeStyle = "rgba(255, 0, 0, 0.5)";

  for (const stroke of state.maskStrokes) {
    if (stroke.points.length < 2) continue;
    exportCtx.lineWidth = stroke.size;
    exportCtx.beginPath();
    exportCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (const point of stroke.points.slice(1)) {
      exportCtx.lineTo(point.x, point.y);
    }
    exportCtx.stroke();
  }

  const blob = await new Promise((resolve) => exportCanvas.toBlob(resolve, "image/png"));
  if (!blob) return null;
  return new File([blob], "marked-defect-frame.png", { type: "image/png" });
}

function safeJson(value) {
  return JSON.stringify(value, null, 2);
}
async function submitFalJob() {
  const apiKey = els.apiKey.value.trim();
  const prompt = els.promptOutput.value.trim();
  const videoUrl = els.videoUrl.value.trim();
  const videoFile = selectedFile(els.videoFile);

  if (!apiKey) {
    showToast("請先輸入 fal API key。");
    return;
  }
  if (!videoUrl && !videoFile) {
    showToast("請先上傳影片。進階 video URL 可以留空。");
    return;
  }

  const model = currentModel();
  const schema = schemaFor(model);
  if (hasVisualGuides() && !schema.supportsVisualGuides) {
    updateCompatibilityWarning();
    const ok = window.confirm(`${model.name} 的 fal schema 只會正式接收 ${schema.officialInputs.join(" + ")}。Before/after 圖和紅色 mask 會上傳到 fal storage，但不會放入模型 input。仍然要提交並扣費嗎？`);
    if (!ok) return;
  }

  els.submitFalJob.disabled = true;
  els.cloudStatus.value = "";
  statusLine("準備直接由瀏覽器上傳到 fal storage...");
  statusLine("提醒：API key 會在此瀏覽器中使用，只適合自己使用，不建議公開給其他人。");

  try {
    const fal = await loadFalClient();
    fal.config({ credentials: apiKey });

    const uploaded = {
      video_url: videoUrl || await uploadDirectToFal(fal, "影片", videoFile),
      before_reference_url: await uploadDirectToFal(fal, "執前參考圖", selectedFile(els.beforeImage)),
      after_reference_url: await uploadDirectToFal(fal, "執後參考圖", selectedFile(els.afterImage)),
      defect_frame_url: await uploadDirectToFal(fal, "瑕疵截圖", selectedFile(els.maskImage)),
      marked_defect_frame_url: await uploadDirectToFal(fal, "紅色標記截圖", await getMarkedFrameFileIfAny()),
      mask_url: await uploadDirectToFal(fal, "透明 mask", await getMaskFileIfAny())
    };

    if (!uploaded.video_url) {
      throw new Error("未能取得影片 URL。請重新選擇影片或使用進階 video URL。");
    }

    const input = buildSubmittedInput(model, prompt, uploaded);
    const notModelInput = uploadedButNotModelInput(uploaded);

    statusLine(`提交到 fal 模型: ${model.id}`);
    statusLine(`實際送入模型 input 欄位: ${Object.keys(input).join(", ")}`);
    if (!schema.supportsVisualGuides && (uploaded.before_reference_url || uploaded.after_reference_url || uploaded.defect_frame_url || uploaded.marked_defect_frame_url || uploaded.mask_url)) {
      statusLine("注意：參考圖 / mask 已上傳，但此模型 schema 不會正式讀取它們。");
    } else if (schema.supportsVisualGuides && input.image_urls?.length) {
      statusLine(`參考圖已正式送入模型 image_urls: ${input.image_urls.length} 張`);
    }
    const result = await fal.subscribe(model.id, {
      input,
      logs: true,
      onQueueUpdate(update) {
        if (update.status) statusLine(`fal 狀態: ${update.status}`);
        if (Array.isArray(update.logs)) {
          for (const log of update.logs) {
            if (log.message) statusLine(`fal: ${log.message}`);
          }
        }
      }
    });

    const data = {
      ok: true,
      mode: "browser-direct-fal-storage",
      model: model.id,
      model_schema: schema,
      submitted_input: input,
      uploaded_but_not_model_input: schema.supportsVisualGuides ? null : notModelInput,
      uploaded,
      result
    };

    els.cloudStatus.value = safeJson(data);
    const maybeResult = findVideoUrl(data);
    if (maybeResult) {
      els.resultVideoUrl.value = maybeResult;
      loadResultVideo();
      showToast("修復完成，結果影片已載入。");
    } else {
      showToast("fal 已回傳結果，但未自動找到影片 URL。請查看處理狀態。");
    }
  } catch (error) {
    els.cloudStatus.value = safeJson({
      ok: false,
      error: error.message || "提交失敗。",
      fix: "如果是 CORS 或 Authorization 錯誤，代表 fal 不允許前端直連；需要改回 server proxy 或 Render/Railway 部署。"
    });
    showToast("提交失敗。");
  } finally {
    els.submitFalJob.disabled = false;
  }
}
function loadResultVideo() {
  const url = els.resultVideoUrl.value.trim();
  if (!url) {
    showToast("請先貼上輸出影片 URL。");
    return;
  }
  els.resultVideoPreview.src = url;
  els.resultVideoEmpty.hidden = true;
  els.downloadResultVideo.href = url;
  updateOutputs();
}

function bindEvents() {
  els.toggleKey.addEventListener("click", () => {
    const visible = els.apiKey.type === "text";
    els.apiKey.type = visible ? "password" : "text";
    els.toggleKey.textContent = visible ? "顯示" : "隱藏";
  });

  els.videoFile.addEventListener("change", handleVideoUpload);
  els.beforeImage.addEventListener("change", () => handleReferenceUpload(els.beforeImage, els.beforePreview, els.beforeFileName, "未選擇圖片"));
  els.afterImage.addEventListener("change", () => handleReferenceUpload(els.afterImage, els.afterPreview, els.afterFileName, "未選擇圖片"));
  els.maskImage.addEventListener("change", loadMaskImage);

  els.maskCanvas.addEventListener("pointerdown", startStroke);
  els.maskCanvas.addEventListener("pointermove", moveStroke);
  window.addEventListener("pointerup", endStroke);
  els.maskCanvas.addEventListener("touchstart", startStroke, { passive: false });
  els.maskCanvas.addEventListener("touchmove", moveStroke, { passive: false });
  window.addEventListener("touchend", endStroke);

  els.undoMask.addEventListener("click", () => {
    state.maskStrokes.pop();
    redrawMask();
  });

  els.clearMask.addEventListener("click", () => {
    state.maskStrokes = [];
    redrawMask();
  });

  els.downloadMask.addEventListener("click", downloadMask);
  els.copyPrompt.addEventListener("click", () => copyText(els.promptOutput.value, "英文 prompt"));
  els.copyJson.addEventListener("click", () => copyText(els.jsonOutput.value, "JSON"));
  els.downloadSpec.addEventListener("click", () => downloadText("repair-spec.json", els.jsonOutput.value));
  els.submitFalJob.addEventListener("click", submitFalJob);
  els.loadResultVideo.addEventListener("click", loadResultVideo);

  for (const id of inputIds) {
    document.querySelector(`#${id}`).addEventListener("input", updateOutputs);
  }
}

renderModels();
bindEvents();
redrawMask();
updateOutputs();




















