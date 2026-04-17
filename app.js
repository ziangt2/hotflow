const state = {
  platform: "全部",
  category: "全部",
  keyword: "",
  sortBy: "views",
  refreshSeconds: 0,
  refreshTimer: null,
  trends: [],
  sourceStatus: [],
  selectedId: null,
  loadingTrends: false,
  generating: false,
  generatedPack: null,
  previewUrl: null,
  renderingPreview: false
};

const els = {
  platformFilter: document.getElementById("platformFilter"),
  categoryFilter: document.getElementById("categoryFilter"),
  keywordInput: document.getElementById("keywordInput"),
  sortFilter: document.getElementById("sortFilter"),
  refreshFilter: document.getElementById("refreshFilter"),
  positioningInput: document.getElementById("positioningInput"),
  syncButton: document.getElementById("syncButton"),
  sourceStatus: document.getElementById("sourceStatus"),
  topInsight: document.getElementById("topInsight"),
  videoCount: document.getElementById("videoCount"),
  highPotentialCount: document.getElementById("highPotentialCount"),
  avgHeat: document.getElementById("avgHeat"),
  resultMeta: document.getElementById("resultMeta"),
  leaderboard: document.getElementById("leaderboard"),
  trendList: document.getElementById("trendList"),
  analysisPanel: document.getElementById("analysisPanel"),
  offerInput: document.getElementById("offerInput"),
  audienceInput: document.getElementById("audienceInput"),
  goalInput: document.getElementById("goalInput"),
  toneInput: document.getElementById("toneInput"),
  mimicInput: document.getElementById("mimicInput"),
  generateButton: document.getElementById("generateButton"),
  scriptOutput: document.getElementById("scriptOutput"),
  videoLengthInput: document.getElementById("videoLengthInput"),
  videoThemeInput: document.getElementById("videoThemeInput"),
  previewButton: document.getElementById("previewButton"),
  videoOutput: document.getElementById("videoOutput")
};

const previewCanvas = document.createElement("canvas");
previewCanvas.width = 720;
previewCanvas.height = 1280;
const previewContext = previewCanvas.getContext("2d");

function textOrDefault(value, fallback = "未提供") {
  return value && String(value).trim() ? String(value).trim() : fallback;
}

function api(path, options = {}) {
  return fetch(path, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  }).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "请求失败");
    }
    return payload;
  });
}

function scoreVideo(video) {
  const hookScore = Math.min(30, (video.hooks || []).length * 8);
  const reusableScore = Math.min(30, (video.reusableAngles || []).length * 9);
  const heatScore = Math.round((Number(video.heat) || 0) * 0.4);
  const total = Math.min(100, hookScore + reusableScore + heatScore);

  return {
    total,
    hookScore,
    reusableScore,
    heatScore
  };
}

function filteredVideos() {
  const matched = state.trends.filter((video) => {
    const matchPlatform = state.platform === "全部" || video.platform === state.platform;
    const matchCategory = state.category === "全部" || video.category === state.category;
    const keyword = state.keyword.trim().toLowerCase();
    const searchSeed = [
      video.title,
      video.summary,
      video.creator,
      video.platform,
      video.category,
      ...(video.tags || [])
    ]
      .join(" ")
      .toLowerCase();
    const matchKeyword = !keyword || searchSeed.includes(keyword);
    return matchPlatform && matchCategory && matchKeyword;
  });

  return matched.sort((left, right) => sortValue(right) - sortValue(left));
}

function sortValue(video) {
  const metrics = video.rawMetrics || {};
  if (state.sortBy === "likes") {
    return Number(metrics.likes || 0);
  }
  if (state.sortBy === "shares") {
    return Number(metrics.shares || 0);
  }
  if (state.sortBy === "heat") {
    return Number(video.heat || 0);
  }
  return Number(metrics.views || 0);
}

function getSelectedVideo(videos) {
  return videos.find((video) => video.id === state.selectedId) || videos[0] || null;
}

function updateFilterOptions() {
  const platformOptions = ["全部", ...new Set(state.trends.map((item) => item.platform).filter(Boolean))];
  const categoryOptions = ["全部", ...new Set(state.trends.map((item) => item.category).filter(Boolean))];

  const currentPlatform = state.platform;
  const currentCategory = state.category;

  els.platformFilter.innerHTML = platformOptions
    .map((option) => `<option value="${option}">${option}</option>`)
    .join("");
  els.categoryFilter.innerHTML = categoryOptions
    .map((option) => `<option value="${option}">${option}</option>`)
    .join("");

  els.platformFilter.value = platformOptions.includes(currentPlatform) ? currentPlatform : "全部";
  els.categoryFilter.value = categoryOptions.includes(currentCategory) ? currentCategory : "全部";
  state.platform = els.platformFilter.value;
  state.category = els.categoryFilter.value;
}

function renderStats(videos) {
  const avgHeat =
    videos.length === 0
      ? 0
      : Math.round(videos.reduce((sum, video) => sum + (Number(video.heat) || 0), 0) / videos.length);
  const highPotentialCount = videos.filter((video) => scoreVideo(video).total >= 85).length;

  els.videoCount.textContent = String(videos.length);
  els.highPotentialCount.textContent = String(highPotentialCount);
  els.avgHeat.textContent = String(avgHeat);
  const refreshLabel = state.refreshSeconds ? `，每 ${Math.round(state.refreshSeconds / 60)} 分钟自动刷新` : "";
  els.resultMeta.textContent = state.loadingTrends ? "正在同步..." : `共 ${videos.length} 条候选${refreshLabel}`;
}

function renderSourceStatus() {
  if (!state.sourceStatus.length) {
    els.sourceStatus.innerHTML = "<span class='status-pill muted'>尚未同步数据源</span>";
    return;
  }

  els.sourceStatus.innerHTML = state.sourceStatus
    .map((source) => {
      const statusClass = source.ok ? "ok" : "error";
      const label = source.ok ? `已接入 ${source.count} 条` : textOrDefault(source.message, "未配置");
      return `<span class="status-pill ${statusClass}">${source.name} · ${label}</span>`;
    })
    .join("");
}

function renderInsight(videos) {
  if (!videos.length) {
    els.topInsight.innerHTML = `
      <p class="analysis-meta">
        当前还没有拉到真实热点。先检查后端配置，或者把真实导出的 JSON 放到 <code>data/live_trends.json</code>。
      </p>
    `;
    return;
  }

  const best = [...videos].sort((a, b) => scoreVideo(b).total - scoreVideo(a).total)[0];
  const score = scoreVideo(best);
  const positioning = textOrDefault(els.positioningInput.value, "你的账号");

  els.topInsight.innerHTML = `
    <h3 class="headline">${best.platform} / ${best.category}</h3>
    <p class="analysis-meta">
      对 <strong>${positioning}</strong> 来说，当前最值得切的是
      <strong>${best.title}</strong>。综合可复用分 <strong>${score.total}</strong>，
      爆点集中在 ${textOrDefault((best.hooks || [])[0], "强钩子")} 和 ${textOrDefault((best.reusableAngles || [])[0], "可复制结构")}。
    </p>
  `;
}

function renderTrendList(videos) {
  if (state.loadingTrends) {
    els.trendList.innerHTML = "<div class='empty-state'>正在同步真实热点数据...</div>";
    return;
  }

  if (!videos.length) {
    els.trendList.innerHTML = "<div class='empty-state'>当前没有可展示的真实热点</div>";
    return;
  }

  const selected = getSelectedVideo(videos);
  state.selectedId = selected ? selected.id : null;

  els.trendList.innerHTML = videos
    .map((video) => {
      const score = scoreVideo(video);
      const tags = (video.tags || []).map((tag) => `<span class="tag-chip">${tag}</span>`).join("");
      return `
        <article class="trend-card ${video.id === state.selectedId ? "active" : ""}" data-id="${video.id}">
          <div class="trend-topline">
            <span class="platform-badge">${textOrDefault(video.platform)}</span>
            <span class="score-pill">可跟拍 ${score.total}</span>
          </div>
          <h4>${textOrDefault(video.title)}</h4>
          <p>${textOrDefault(video.summary)}</p>
          <div class="chip-row trend-tags">${tags}</div>
          <div class="score-row">
            <span class="score-pill">热度 ${textOrDefault(video.heat, 0)}</span>
            <span class="score-pill">播放 ${textOrDefault(video.rawMetrics?.views, 0)}</span>
            <span class="score-pill">点赞 ${textOrDefault(video.rawMetrics?.likes, 0)}</span>
            <span class="score-pill">${textOrDefault(video.velocity)}</span>
            <span class="score-pill">${textOrDefault(video.creator)}</span>
          </div>
        </article>
      `;
    })
    .join("");

  document.querySelectorAll(".trend-card").forEach((card) => {
    card.addEventListener("click", () => {
      state.selectedId = card.dataset.id;
      render();
    });
  });
}

function renderLeaderboard(videos) {
  if (!videos.length) {
    els.leaderboard.innerHTML = "<div class='empty-state'>接入实时源后，这里会显示每个类别当前最爆的一条。</div>";
    return;
  }

  const bestByCategory = new Map();
  videos.forEach((video) => {
    const category = textOrDefault(video.category, "未分类");
    if (!bestByCategory.has(category)) {
      bestByCategory.set(category, video);
    }
  });

  els.leaderboard.innerHTML = Array.from(bestByCategory.entries())
    .map(([category, video]) => {
      const primaryMetric =
        state.sortBy === "likes"
          ? `点赞 ${textOrDefault(video.rawMetrics?.likes, 0)}`
          : state.sortBy === "shares"
            ? `分享 ${textOrDefault(video.rawMetrics?.shares, 0)}`
            : state.sortBy === "heat"
              ? `热度 ${textOrDefault(video.heat, 0)}`
              : `播放 ${textOrDefault(video.rawMetrics?.views, 0)}`;

      return `
        <article class="leader-card">
          <h5>${category}</h5>
          <h4>${textOrDefault(video.title)}</h4>
          <p>${textOrDefault(video.summary)}</p>
          <div class="chip-row trend-tags">
            <span class="platform-badge">${textOrDefault(video.platform)}</span>
            <span class="score-pill">${primaryMetric}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderAnalysis(video) {
  if (!video) {
    els.analysisPanel.className = "analysis-panel empty-state";
    els.analysisPanel.textContent = "同步到真实热点后，选择左侧视频查看结构和可复用钩子。";
    return;
  }

  const score = scoreVideo(video);
  const structure = (video.structure || []).map((item) => `<li>${item}</li>`).join("");
  const reusable = (video.reusableAngles || []).map((item) => `<li>${item}</li>`).join("");

  els.analysisPanel.className = "analysis-panel";
  els.analysisPanel.innerHTML = `
    <div class="analysis-section">
      <p class="eyebrow">热点摘要</p>
      <h3 class="headline">${textOrDefault(video.title)}</h3>
      <p class="analysis-meta">${textOrDefault(video.summary)}</p>
    </div>
    <div class="analysis-section">
      <h4>爆点信号</h4>
      <ul class="analysis-list">
        <li>热度分：${score.heatScore}</li>
        <li>钩子分：${score.hookScore}</li>
        <li>复用分：${score.reusableScore}</li>
        <li>建议切入：${(video.hooks || []).join(" / ") || "待补充"}</li>
      </ul>
    </div>
    <div class="analysis-section">
      <h4>视频结构</h4>
      <ul class="analysis-list">
        ${structure || "<li>当前数据源未提供结构化拆解</li>"}
      </ul>
    </div>
    <div class="analysis-section">
      <h4>可直接借用的打法</h4>
      <ul class="analysis-list">
        ${reusable || "<li>当前数据源未提供复用角度</li>"}
      </ul>
    </div>
  `;
}

function renderGeneratedPack(pack) {
  state.generatedPack = pack;
  const hashtags = (pack.hashtags || []).map((tag) => `<span class="tag-chip">${tag}</span>`).join("");
  const outline = (pack.outline || []).map((item) => `<li>${item}</li>`).join("");
  const shots = (pack.shots || []).map((item) => `<li>${item}</li>`).join("");
  const captions = (pack.coverLines || []).map((item) => `<li>${item}</li>`).join("");
  const coversText = (pack.coverLines || []).join("\n");

  els.scriptOutput.className = "script-output";
  els.scriptOutput.innerHTML = `
    <div class="script-section">
      <p class="eyebrow">内容包</p>
      <h3 class="headline">${textOrDefault(pack.title)}</h3>
      <p class="script-copy">${textOrDefault(pack.lead)}</p>
      <div class="chip-row trend-tags">${hashtags}</div>
      <div class="action-row">
        <button class="mini-button" data-copy="${encodeURIComponent(textOrDefault(pack.title))}">复制标题</button>
        <button class="mini-button" data-copy="${encodeURIComponent(textOrDefault(pack.script))}">复制口播</button>
        <button class="mini-button" data-copy="${encodeURIComponent(coversText)}">复制封面文案</button>
        <button class="mini-button" data-copy="${encodeURIComponent(textOrDefault(pack.cta))}">复制CTA</button>
      </div>
    </div>
    <div class="script-grid">
      <div class="script-section">
        <h4>完整口播文案</h4>
        <p class="script-copy prewrap">${textOrDefault(pack.script)}</p>
      </div>
      <div class="script-section">
        <h4>结构大纲</h4>
        <ul class="script-list">
          ${outline || "<li>暂无</li>"}
        </ul>
      </div>
    </div>
    <div class="script-grid">
      <div class="script-section">
        <h4>封面文案</h4>
        <ul class="script-list">
          ${captions || "<li>暂无</li>"}
        </ul>
      </div>
      <div class="script-section">
        <h4>分镜建议</h4>
        <ul class="script-list">
          ${shots || "<li>暂无</li>"}
        </ul>
      </div>
    </div>
    <div class="script-section">
      <h4>结尾 CTA</h4>
      <p class="script-copy">${textOrDefault(pack.cta)}</p>
    </div>
  `;

  bindCopyButtons();
  renderVideoPanel();
}

function bindCopyButtons() {
  els.scriptOutput.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      const content = decodeURIComponent(button.dataset.copy || "");
      try {
        await navigator.clipboard.writeText(content);
        button.textContent = "已复制";
        setTimeout(() => {
          if (button.textContent === "已复制") {
            if (content === textOrDefault(state.generatedPack?.title)) {
              button.textContent = "复制标题";
            } else if (content === textOrDefault(state.generatedPack?.script)) {
              button.textContent = "复制口播";
            } else if (content === (state.generatedPack?.coverLines || []).join("\n")) {
              button.textContent = "复制封面文案";
            } else {
              button.textContent = "复制CTA";
            }
          }
        }, 1200);
      } catch (error) {
        button.textContent = "复制失败";
      }
    });
  });
}

function render() {
  updateFilterOptions();
  renderSourceStatus();
  const videos = filteredVideos();
  const selectedVideo = getSelectedVideo(videos);
  renderStats(videos);
  renderInsight(videos);
  renderTrendList(videos);
  renderAnalysis(selectedVideo);
  renderLeaderboard(videos);
}

async function loadTrends() {
  state.loadingTrends = true;
  render();

  try {
    const params = new URLSearchParams({
      platform: state.platform,
      category: state.category
    });
    const payload = await api(`/api/trends?${params.toString()}`);
    state.trends = payload.items || [];
    state.sourceStatus = payload.sources || [];
    if (!state.trends.some((item) => item.id === state.selectedId)) {
      state.selectedId = state.trends[0]?.id || null;
    }
  } catch (error) {
    state.trends = [];
    state.sourceStatus = [
      {
        name: "趋势聚合器",
        ok: false,
        count: 0,
        message: error.message
      }
    ];
  } finally {
    state.loadingTrends = false;
    render();
  }
}

async function generatePack() {
  const selectedVideo = getSelectedVideo(filteredVideos());
  if (!selectedVideo) {
    els.scriptOutput.className = "script-output empty-state";
    els.scriptOutput.textContent = "先同步真实热点并选中一条视频，再生成完整内容包。";
    return;
  }

  state.generating = true;
  els.generateButton.disabled = true;
  els.generateButton.textContent = "生成中...";

  try {
    const payload = await api("/api/generate", {
      method: "POST",
      body: JSON.stringify({
        trendId: selectedVideo.id,
        trend: selectedVideo,
        positioning: els.positioningInput.value.trim(),
        offer: els.offerInput.value.trim(),
        audience: els.audienceInput.value.trim(),
        goal: els.goalInput.value,
        tone: els.toneInput.value,
        mimicLevel: els.mimicInput.value
      })
    });
    renderGeneratedPack(payload.content || {});
  } catch (error) {
    els.scriptOutput.className = "script-output empty-state";
    els.scriptOutput.textContent = `生成失败：${error.message}`;
  } finally {
    state.generating = false;
    els.generateButton.disabled = false;
    els.generateButton.textContent = "生成完整内容包";
  }
}

function wrapText(context, text, maxWidth) {
  const words = String(text || "").split("");
  const lines = [];
  let current = "";

  words.forEach((char) => {
    const next = current + char;
    if (context.measureText(next).width > maxWidth && current) {
      lines.push(current);
      current = char;
    } else {
      current = next;
    }
  });

  if (current) {
    lines.push(current);
  }

  return lines;
}

function getThemePalette(theme) {
  if (theme === "冷感青绿") {
    return {
      background: ["#092f34", "#0e5a5a"],
      accent: "#8af5d3",
      text: "#f3fff9",
      subtext: "rgba(243,255,249,0.82)",
      panel: "rgba(255,255,255,0.10)"
    };
  }

  if (theme === "高级米白") {
    return {
      background: ["#f4ecdf", "#d7c1a7"],
      accent: "#9b5c31",
      text: "#231815",
      subtext: "rgba(35,24,21,0.74)",
      panel: "rgba(255,255,255,0.48)"
    };
  }

  return {
    background: ["#45180f", "#d55d3a"],
    accent: "#ffd27f",
    text: "#fff8ef",
    subtext: "rgba(255,248,239,0.84)",
    panel: "rgba(255,255,255,0.12)"
  };
}

function splitScriptToScenes(pack) {
  const scriptSentences = textOrDefault(pack.script, "")
    .split(/[\n。！？!?]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const coverLines = (pack.coverLines || []).filter(Boolean);
  const shots = (pack.shots || []).filter(Boolean);

  return [
    {
      label: "开场钩子",
      headline: textOrDefault(pack.title),
      body: coverLines[0] || textOrDefault(pack.lead),
      footer: shots[0] || "人物直视镜头抛结论"
    },
    {
      label: "痛点场景",
      headline: coverLines[1] || "把用户痛点讲清楚",
      body: scriptSentences[0] || textOrDefault(pack.lead),
      footer: shots[1] || "插入案例或对比"
    },
    {
      label: "解决方案",
      headline: "三步拆解你的价值",
      body: [scriptSentences[1], scriptSentences[2]].filter(Boolean).join("。"),
      footer: shots[2] || "展示过程或界面特写"
    },
    {
      label: "行动引导",
      headline: coverLines[2] || "把 CTA 说清楚",
      body: scriptSentences.slice(3).join("。") || textOrDefault(pack.cta),
      footer: shots[3] || textOrDefault(pack.cta)
    }
  ].filter((scene) => scene.body || scene.headline);
}

function drawRoundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function renderSceneFrame(scene, index, totalScenes, progress, themeName) {
  const palette = getThemePalette(themeName);
  const gradient = previewContext.createLinearGradient(0, 0, previewCanvas.width, previewCanvas.height);
  gradient.addColorStop(0, palette.background[0]);
  gradient.addColorStop(1, palette.background[1]);
  previewContext.fillStyle = gradient;
  previewContext.fillRect(0, 0, previewCanvas.width, previewCanvas.height);

  previewContext.fillStyle = "rgba(255,255,255,0.08)";
  previewContext.beginPath();
  previewContext.arc(140, 160, 120 + progress * 25, 0, Math.PI * 2);
  previewContext.fill();
  previewContext.beginPath();
  previewContext.arc(580, 1080, 180 - progress * 20, 0, Math.PI * 2);
  previewContext.fill();

  previewContext.fillStyle = palette.panel;
  drawRoundedRect(previewContext, 48, 48, 624, 1184, 36);
  previewContext.fill();

  previewContext.fillStyle = palette.accent;
  previewContext.font = "700 28px Space Grotesk";
  previewContext.fillText(`HOTFLOW PREVIEW 0${index + 1}`, 88, 116);

  previewContext.fillStyle = palette.text;
  previewContext.font = "900 60px Noto Sans SC";
  const headlineLines = wrapText(previewContext, scene.headline, 520);
  headlineLines.slice(0, 3).forEach((line, lineIndex) => {
    previewContext.fillText(line, 88, 250 + lineIndex * 78);
  });

  previewContext.fillStyle = palette.subtext;
  previewContext.font = "500 34px Noto Sans SC";
  const bodyLines = wrapText(previewContext, scene.body, 520);
  bodyLines.slice(0, 7).forEach((line, lineIndex) => {
    previewContext.fillText(line, 88, 520 + lineIndex * 52);
  });

  previewContext.fillStyle = palette.accent;
  drawRoundedRect(previewContext, 88, 938, 260, 72, 20);
  previewContext.fill();
  previewContext.fillStyle = themeName === "高级米白" ? "#fffaf3" : "#231815";
  previewContext.font = "700 28px Noto Sans SC";
  previewContext.fillText(scene.label, 118, 984);

  previewContext.fillStyle = palette.text;
  previewContext.font = "600 30px Noto Sans SC";
  const footerLines = wrapText(previewContext, scene.footer, 520);
  footerLines.slice(0, 3).forEach((line, lineIndex) => {
    previewContext.fillText(line, 88, 1098 + lineIndex * 44);
  });

  const barWidth = 520 * ((index + progress) / totalScenes);
  previewContext.fillStyle = "rgba(255,255,255,0.18)";
  drawRoundedRect(previewContext, 88, 1180, 520, 14, 7);
  previewContext.fill();
  previewContext.fillStyle = palette.accent;
  drawRoundedRect(previewContext, 88, 1180, barWidth, 14, 7);
  previewContext.fill();
}

async function createPreviewVideo(pack) {
  const duration = Number(els.videoLengthInput.value || 18);
  const themeName = els.videoThemeInput.value;
  const scenes = splitScriptToScenes(pack);
  const stream = previewCanvas.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
  const chunks = [];

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  });

  const finished = new Promise((resolve) => {
    recorder.addEventListener("stop", () => {
      resolve(new Blob(chunks, { type: "video/webm" }));
    });
  });

  recorder.start();

  const frames = Math.max(1, duration * 30);
  for (let frame = 0; frame < frames; frame += 1) {
    const timeline = frame / frames;
    const sceneIndex = Math.min(scenes.length - 1, Math.floor(timeline * scenes.length));
    const sceneProgress = (timeline * scenes.length) % 1;
    renderSceneFrame(scenes[sceneIndex], sceneIndex, scenes.length, sceneProgress, themeName);
    await new Promise((resolve) => setTimeout(resolve, 1000 / 30));
  }

  recorder.stop();
  const blob = await finished;
  return {
    blob,
    url: URL.createObjectURL(blob),
    scenes
  };
}

function renderVideoPanel() {
  if (!state.generatedPack) {
    els.videoOutput.className = "video-output empty-state";
    els.videoOutput.textContent = "先生成一份内容包，然后这里会出现可播放、可下载的视频预览。";
    return;
  }

  if (!state.previewUrl) {
    const scenes = splitScriptToScenes(state.generatedPack);
    els.videoOutput.className = "video-output";
    els.videoOutput.innerHTML = `
      <div class="video-preview-shell">
        <div class="video-stage">
          <canvas class="preview-video" width="720" height="1280"></canvas>
        </div>
        <div class="scene-board">
          ${scenes
            .map(
              (scene, index) => `
                <article class="scene-card">
                  <h4>场景 ${index + 1} · ${scene.label}</h4>
                  <p>${scene.headline}</p>
                  <p>${scene.body}</p>
                </article>
              `
            )
            .join("")}
        </div>
      </div>
    `;

    const canvas = els.videoOutput.querySelector("canvas");
    const context = canvas.getContext("2d");
    renderSceneFrame(scenes[0], 0, scenes.length, 0.15, els.videoThemeInput.value);
    context.drawImage(previewCanvas, 0, 0, canvas.width, canvas.height);
    return;
  }

  const scenes = splitScriptToScenes(state.generatedPack);
  els.videoOutput.className = "video-output";
  els.videoOutput.innerHTML = `
    <div class="video-preview-shell">
      <div class="video-stage">
        <video class="preview-video" src="${state.previewUrl}" controls loop playsinline></video>
        <a class="download-button" href="${state.previewUrl}" download="hotflow-preview.webm">下载视频预览</a>
      </div>
      <div class="scene-board">
        ${scenes
          .map(
            (scene, index) => `
              <article class="scene-card">
                <h4>场景 ${index + 1} · ${scene.label}</h4>
                <p>${scene.headline}</p>
                <p>${scene.body}</p>
              </article>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

async function generatePreviewVideo() {
  if (!state.generatedPack) {
    els.videoOutput.className = "video-output empty-state";
    els.videoOutput.textContent = "先生成完整内容包，再生成视频预览。";
    return;
  }

  if (state.previewUrl) {
    URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = null;
  }

  state.renderingPreview = true;
  els.previewButton.disabled = true;
  els.previewButton.textContent = "视频生成中...";
  els.videoOutput.className = "video-output empty-state";
  els.videoOutput.textContent = "正在把文案和分镜排成短视频预览，请等几秒。";

  try {
    const result = await createPreviewVideo(state.generatedPack);
    state.previewUrl = result.url;
    renderVideoPanel();
  } catch (error) {
    els.videoOutput.className = "video-output empty-state";
    els.videoOutput.textContent = `视频生成失败：${error.message}`;
  } finally {
    state.renderingPreview = false;
    els.previewButton.disabled = false;
    els.previewButton.textContent = "生成视频预览";
  }
}

function bindEvents() {
  els.platformFilter.addEventListener("change", (event) => {
    state.platform = event.target.value;
    render();
  });

  els.categoryFilter.addEventListener("change", (event) => {
    state.category = event.target.value;
    render();
  });

  els.sortFilter.addEventListener("change", (event) => {
    state.sortBy = event.target.value;
    render();
  });

  els.refreshFilter.addEventListener("change", (event) => {
    state.refreshSeconds = Number(event.target.value || 0);
    if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }
    if (state.refreshSeconds > 0) {
      state.refreshTimer = setInterval(() => {
        loadTrends();
      }, state.refreshSeconds * 1000);
    }
    render();
  });

  els.keywordInput.addEventListener("input", (event) => {
    state.keyword = event.target.value || "";
    render();
  });

  els.positioningInput.addEventListener("input", () => renderInsight(filteredVideos()));
  els.syncButton.addEventListener("click", loadTrends);
  els.generateButton.addEventListener("click", generatePack);
  els.previewButton.addEventListener("click", generatePreviewVideo);
  els.videoThemeInput.addEventListener("change", renderVideoPanel);
}

bindEvents();
render();
loadTrends();
