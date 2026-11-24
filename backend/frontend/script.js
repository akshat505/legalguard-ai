const API_BASE = "";
let authToken = localStorage.getItem("lg_token") || null;
let currentUsername = localStorage.getItem("lg_username") || "";

// ---------- Auth elements ----------
const authView = document.getElementById("auth-view");
const appView = document.getElementById("app-view");
const tabLogin = document.getElementById("tab-login");
const tabSignup = document.getElementById("tab-signup");
const loginPanel = document.getElementById("login-panel");
const signupPanel = document.getElementById("signup-panel");
const authError = document.getElementById("auth-error");
const welcomeUser = document.getElementById("welcome-user");
const logoutBtn = document.getElementById("logout-btn");

tabLogin.onclick = () => switchAuthMode("login");
tabSignup.onclick = () => switchAuthMode("signup");

function switchAuthMode(mode) {
  tabLogin.classList.toggle("active", mode === "login");
  tabSignup.classList.toggle("active", mode === "signup");
  loginPanel.classList.toggle("hidden", mode !== "login");
  signupPanel.classList.toggle("hidden", mode !== "signup");
  authError.innerHTML = "";
}

document.getElementById("login-btn").onclick = async () => {
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  authError.innerHTML = "";

  if (!username || !password) {
    authError.innerHTML = `<div class="error-box">Please enter username and password.</div>`;
    return;
  }

  try {
    const res = await fetch(API_BASE + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Login failed.");

    authToken = data.token;
    currentUsername = data.username;
    localStorage.setItem("lg_token", authToken);
    localStorage.setItem("lg_username", currentUsername);
    showApp();
  } catch (err) {
    authError.innerHTML = `<div class="error-box">${err.message}</div>`;
  }
};

document.getElementById("signup-btn").onclick = async () => {
  const username = document.getElementById("signup-username").value.trim();
  const email = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;
  authError.innerHTML = "";

  if (!username || !email || !password) {
    authError.innerHTML = `<div class="error-box">Please fill in all fields.</div>`;
    return;
  }
  if (password.length < 6) {
    authError.innerHTML = `<div class="error-box">Password must be at least 6 characters.</div>`;
    return;
  }

  try {
    const res = await fetch(API_BASE + "/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Signup failed.");

    authToken = data.token;
    currentUsername = data.username;
    localStorage.setItem("lg_token", authToken);
    localStorage.setItem("lg_username", currentUsername);
    showApp();
  } catch (err) {
    authError.innerHTML = `<div class="error-box">${err.message}</div>`;
  }
};

logoutBtn.onclick = () => {
  authToken = null;
  currentUsername = "";
  localStorage.removeItem("lg_token");
  localStorage.removeItem("lg_username");
  appView.classList.add("hidden");
  authView.classList.remove("hidden");
};

function showApp() {
  authView.classList.add("hidden");
  appView.classList.remove("hidden");
  welcomeUser.textContent = "👋 " + currentUsername;
}

function authHeaders(extra = {}) {
  return { ...extra, Authorization: "Bearer " + authToken };
}

// On page load, check if we already have a token
if (authToken) {
  showApp();
} else {
  authView.classList.remove("hidden");
}
// ---------- Top-level view switching ----------
const viewAnalyzeBtn = document.getElementById("view-analyze");
const viewHistoryBtn = document.getElementById("view-history");
const analyzeView = document.getElementById("analyze-view");
const historyView = document.getElementById("history-view");

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
        headers: authHeaders(),
        body: formData,
      });
    } else {
      response = await fetch(API_BASE + "/api/analyze-text", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ text: textInput.value.trim(), output_language: outputLanguage }),
      });
    }

    const data = await response.json();

    if (response.status === 401) {
      logoutBtn.onclick();
      throw new Error("Session expired. Please log in again.");
    }
    if (!response.ok) throw new Error(data.detail || "Something went wrong.");

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
    ? "AI reasoning was used to enrich explanations."
    : "AI reasoning was unavailable — showing rule-based analysis only.";

  resultsEl.innerHTML = buildReportHtml(data, llmNote);
  attachPdfButton(resultsEl, data);

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

const SEVERITY_RANK = { green: 0, yellow: 1, red: 2 };

// True when the AI rated a clause as MORE risky than the keyword rules did.
function caughtByAi(c) {
  return c.ai_severity && c.rule_severity &&
    SEVERITY_RANK[c.ai_severity] > SEVERITY_RANK[c.rule_severity];
}

function buildReportHtml(data, llmNote, showBackLink) {
  let clausesHtml = "";
  data.clauses.forEach((c) => {
    const flagsHtml = c.flags && c.flags.length
      ? `<div class="flags">Detected: ${c.flags.join(", ")}</div>`
      : "";
    const suggestionHtml = c.suggestion
      ? `<div class="clause-suggestion">🤝 <strong>Suggestion:</strong> ${escapeHtml(c.suggestion)}</div>`
      : "";
    const aiBadgeHtml = caughtByAi(c) ? `<span class="ai-badge">🤖 Caught by AI</span>` : "";
    const verdictHtml = c.rule_severity
      ? `<div class="verdicts">
           <span>🤖 AI: ${c.ai_severity
             ? `<span class="mini-tag ${c.ai_severity}">${c.ai_severity}</span>`
             : `<span class="mini-tag off">not available</span>`}</span>
         </div>`
      : "";
    clausesHtml += `
      <div class="clause ${c.severity}">
        <div class="clause-top">
          <strong>Clause ${c.clause_number}</strong>
          <span class="tags">${aiBadgeHtml}<span class="clause-tag ${c.severity}">${c.severity}</span></span>
        </div>
        <div class="clause-text">${escapeHtml(c.text)}</div>
        <div class="clause-explanation">💡 ${escapeHtml(c.explanation)}</div>
        ${suggestionHtml}
        ${verdictHtml}
        ${flagsHtml}
      </div>
    `;
  });

  // Summary of what the AI did across the whole document
  let aiBoxHtml = "";
  const aiChecked = data.clauses.filter((c) => c.ai_severity).length;
  if (aiChecked) {
    const aiCaught = data.clauses.filter(caughtByAi).length;
    aiBoxHtml = `
      <div class="ai-box">
        🤖 <strong>AI checked ${aiChecked} of ${data.clauses.length} clauses.</strong>
        ${aiCaught
          ? `It found <strong>${aiCaught} risky clause${aiCaught > 1 ? "s" : ""}</strong> that the keyword rules missed (marked "Caught by AI" below).`
          : "It did not find any extra risk beyond the keyword rules."}
      </div>`;
  }

  const backLinkHtml = showBackLink ? `<div class="back-link" id="back-to-history">← Back to history</div>` : "";
  const docTypeHtml = data.document_type ? `<span>Document type: <strong>${escapeHtml(data.document_type)}</strong></span>` : "";
  const summaryHtml = data.overall_summary ? `<div class="overall-summary">📋 ${escapeHtml(data.overall_summary)}</div>` : "";

  return `
    ${backLinkHtml}
    <div class="report-body">
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
        ${docTypeHtml}
        <span>Detected language: <strong>${data.detected_language}</strong></span>
        <span>Explanation language: <strong>${data.output_language}</strong></span>
      </div>
      ${summaryHtml}
      ${aiBoxHtml}
    </div>
    <div class="card">
      <h3 style="margin-top:0;">Clause-by-Clause Breakdown</h3>
      ${clausesHtml}
    </div>
    </div>
    <div class="report-actions">
      <button class="primary pdf-btn">📄 Download PDF</button>
      ${showBackLink ? "" : `<button class="primary" id="new-analysis-btn">Analyze Another Document</button>`}
    </div>
  `;
}

// ---------- Download report as PDF ----------
// Builds the PDF from a copy of the report, with a small title on top.
function makePdf(container, data) {
  const report = container.querySelector(".report-body").cloneNode(true);
  report.classList.add("pdf-page");
  const header = document.createElement("div");
  header.className = "pdf-header";
  const fileLine = data.source_name ? escapeHtml(data.source_name) + " &middot; " : "";
  header.innerHTML = `
    <h1>⚖️ LegalGuard AI – Risk Report</h1>
    <p>${fileLine}Generated on ${new Date().toLocaleString()}</p>`;
  report.prepend(header);

  return html2pdf()
    .set({
      margin: 10,
      filename: "LegalGuard-Report.pdf",
      image: { type: "jpeg", quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak: { mode: ["css", "legacy"], avoid: [".clause", ".score-header", ".pdf-header"] },
    })
    .from(report);
}

function attachPdfButton(container, data) {
  const btn = container.querySelector(".pdf-btn");
  if (!btn) return;

  btn.onclick = async () => {
    if (typeof html2pdf === "undefined") {
      alert("PDF tool could not load. Please check your internet and refresh the page.");
      return;
    }
    btn.disabled = true;
    btn.textContent = "Preparing PDF...";

    try {
      await makePdf(container, data).save();
    } catch (err) {
      alert("Could not create the PDF: " + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "📄 Download PDF";
    }
  };
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
    const res = await fetch(API_BASE + "/api/history", { headers: authHeaders() });
    const data = await res.json();

    if (res.status === 401) {
      logoutBtn.onclick();
      return;
    }
    if (!data.available) {
      historyListEl.innerHTML = `<div class="empty-state">Database not available.</div>`;
      return;
    }
    if (!data.records.length) {
      historyListEl.innerHTML = `<div class="empty-state">No past analyses yet.</div>`;
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
    const res = await fetch(API_BASE + "/api/history/" + id, { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Could not load this record.");

    historyDetailEl.innerHTML = buildReportHtml(data, null, true);
    attachPdfButton(historyDetailEl, data);
    document.getElementById("back-to-history").onclick = () => {
      historyDetailEl.classList.add("hidden");
    };
  } catch (err) {
    historyDetailEl.innerHTML = `<div class="error-box">${err.message}</div>`;
  }
}