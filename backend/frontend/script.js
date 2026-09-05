const API_BASE = "";

const viewAnalyzeBtn = document.getElementById("view-analyze");
const viewHistoryBtn = document.getElementById("view-history");
const analyzeView = document.getElementById("analyze-view");
const historyView = document.getElementById("history-view");

const tabFile = document.getElementById("tab-file");
const tabText = document.getElementById("tab-text");
const filePanel = document.getElementById("file-panel");
const textPanel = document.getElementById("text-panel");
const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const fileNameEl = document.getElementById("file-name");
const textInput = document.getElementById("text-input");
const analyzeBtn = document.getElementById("analyze-btn");
const errorContainer = document.getElementById("error-container");
const uploadCard = document.getElementById("upload-card");
const loadingEl = document.getElementById("loading");
const resultsEl = document.getElementById("results");
const langSelect = document.getElementById("lang-select");

const historyListEl = document.getElementById("history-list");
const historyDetailEl = document.getElementById("history-detail");

let mode = "file";
let selectedFile = null;

// ---------- Top-level view switching ----------
viewAnalyzeBtn.onclick = () => {
  viewAnalyzeBtn.classList.add("active");
  viewHistoryBtn.classList.remove("active");
  analyzeView.classList.remove("hidden");
  historyView.classList.add("hidden");
};

viewHistoryBtn.onclick = () => {
  viewHistoryBtn.classList.add("active");
  viewAnalyzeBtn.classList.remove("active");
  historyView.classList.remove("hidden");
  analyzeView.classList.add("hidden");
  loadHistory();
};

// ---------- Upload/Paste tab switching ----------
tabFile.onclick = () => switchMode("file");
tabText.onclick = () => switchMode("text");

function switchMode(m) {
  mode = m;
  tabFile.classList.toggle("active", m === "file");
  tabText.classList.toggle("active", m === "text");
  filePanel.classList.toggle("hidden", m !== "file");
  textPanel.classList.toggle("hidden", m !== "text");
  updateButtonState();
}

dropZone.onclick = () => fileInput.click();
dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add("dragover"); };
dropZone.ondragleave = () => dropZone.classList.remove("dragover");
dropZone.ondrop = (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  if (e.dataTransfer.files.length) {
    selectedFile = e.dataTransfer.files[0];
    fileNameEl.textContent = "Selected: " + selectedFile.name;
    updateButtonState();
  }
};
fileInput.onchange = () => {
  if (fileInput.files.length) {
    selectedFile = fileInput.files[0];
    fileNameEl.textContent = "Selected: " + selectedFile.name;
    updateButtonState();
  }
};

textInput.oninput = updateButtonState;

function updateButtonState() {
  if (mode === "file") {
    analyzeBtn.disabled = !selectedFile;
  } else {
    analyzeBtn.disabled = textInput.value.trim().length < 50;
  }
}

// ---------- Analyze ----------
analyzeBtn.onclick = async () => {
  errorContainer.innerHTML = "";
  uploadCard.classList.add("hidden");
  loadingEl.classList.remove("hidden");
  resultsEl.classList.add("hidden");

  const outputLanguage = langSelect.value;

  try {
    let response;
    if (mode === "file") {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("output_language", outputLanguage);
      response = await fetch(API_BASE + "/api/analyze", {
        method: "POST",
        body: formData,
      });
    } else {
      response = await fetch(API_BASE + "/api/analyze-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: textInput.value.trim(), output_language: outputLanguage }),
      });
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || "Something went wrong.");
    }

    renderResults(data);
  } catch (err) {
    uploadCard.classList.remove("hidden");
    loadingEl.classList.add("hidden");
    errorContainer.innerHTML = `<div class="error-box">${err.message}</div>`;
  }
};

function renderResults(data) {
  loadingEl.classList.add("hidden");
  resultsEl.classList.remove("hidden");

  const llmNote = data.llm_enabled
    ? "AI reasoning (Ollama) was used to enrich explanations."
    : "AI reasoning was unavailable — showing rule-based analysis only.";

  resultsEl.innerHTML = buildReportHtml(data, llmNote);

  const newBtn = document.getElementById("new-analysis-btn");
  if (newBtn) {
    newBtn.onclick = () => {
      resultsEl.classList.add("hidden");
      uploadCard.classList.remove("hidden");
      selectedFile = null;
      fileInput.value = "";
      fileNameEl.textContent = "";
      textInput.value = "";
      updateButtonState();
    };
  }
}

function buildReportHtml(data, llmNote, showBackLink) {
  let clausesHtml = "";
  data.clauses.forEach((c) => {
    const flagsHtml = c.flags && c.flags.length
      ? `<div class="flags">Detected: ${c.flags.join(", ")}</div>`
      : "";
    clausesHtml += `
      <div class="clause ${c.severity}">
        <div class="clause-top">
          <strong>Clause ${c.clause_number}</strong>
          <span class="clause-tag ${c.severity}">${c.severity}</span>
        </div>
        <div class="clause-text">${escapeHtml(c.text)}</div>
        <div class="clause-explanation">💡 ${escapeHtml(c.explanation)}</div>
        ${flagsHtml}
      </div>
    `;
  });

  const backLinkHtml = showBackLink
    ? `<div class="back-link" id="back-to-history">← Back to history</div>`
    : "";

  return `
    ${backLinkHtml}
    <div class="card">
      <div class="score-header">
        <div>
          <h2 style="margin:0;">Overall Risk Assessment</h2>
          <p style="color:var(--muted); margin:4px 0 0;">${data.clause_count} clauses analyzed &middot; ${llmNote || ""}</p>
        </div>
        <div class="score-badge ${data.risk_level}">${data.risk_level}</div>
      </div>
      <div class="meta-row">
        <span>Risk Score: <strong>${data.risk_score}/100</strong></span>
        <span>Detected document language: <strong>${data.detected_language}</strong></span>
        <span>Explanation language: <strong>${data.output_language}</strong></span>
      </div>
    </div>
    <div class="card">
      <h3 style="margin-top:0;">Clause-by-Clause Breakdown</h3>
      ${clausesHtml}
    </div>
    ${showBackLink ? "" : `<button class="primary" id="new-analysis-btn">Analyze Another Document</button>`}
  `;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------- History ----------
async function loadHistory() {
  historyDetailEl.classList.add("hidden");
  historyListEl.innerHTML = `<p style="color:var(--muted);">Loading...</p>`;

  try {
    const res = await fetch(API_BASE + "/api/history");
    const data = await res.json();

    if (!data.available) {
      historyListEl.innerHTML = `<div class="empty-state">Database not available. Make sure MongoDB is running.</div>`;
      return;
    }

    if (!data.records.length) {
      historyListEl.innerHTML = `<div class="empty-state">No past analyses yet. Analyze a document to see it here.</div>`;
      return;
    }

    historyListEl.innerHTML = data.records.map((r) => {
      const date = new Date(r.timestamp).toLocaleString();
      return `
        <div class="history-item" data-id="${r._id}">
          <div>
            <div class="hi-name">${escapeHtml(r.source_name)}</div>
            <div class="hi-meta">${date} &middot; ${r.clause_count} clauses &middot; Score: ${r.risk_score}/100</div>
          </div>
          <span class="history-badge ${r.risk_level}">${r.risk_level}</span>
        </div>
      `;
    }).join("");

    document.querySelectorAll(".history-item").forEach((el) => {
      el.onclick = () => loadHistoryDetail(el.getAttribute("data-id"));
    });

  } catch (err) {
    historyListEl.innerHTML = `<div class="error-box">Could not load history: ${err.message}</div>`;
  }
}

async function loadHistoryDetail(id) {
  historyDetailEl.classList.remove("hidden");
  historyDetailEl.innerHTML = `<p style="color:var(--muted);">Loading...</p>`;

  try {
    const res = await fetch(API_BASE + "/api/history/" + id);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || "Could not load this record.");
    }

    historyDetailEl.innerHTML = buildReportHtml(data, null, true);

    document.getElementById("back-to-history").onclick = () => {
      historyDetailEl.classList.add("hidden");
    };
  } catch (err) {
    historyDetailEl.innerHTML = `<div class="error-box">${err.message}</div>`;
  }
}