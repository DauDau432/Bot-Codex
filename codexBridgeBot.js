"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv(path.join(__dirname, ".env.codex"));

const CONFIG = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  allowedChatId: process.env.TELEGRAM_ALLOWED_CHAT_ID || "",
  codexCmd: process.env.CODEX_CMD || "/usr/local/bin/codex",
  codexWorkdir: process.env.CODEX_WORKDIR || "/opt/tele-codex-bot/workspace",
  codexModel: process.env.CODEX_MODEL || "",
  codexModelOptions: (process.env.CODEX_MODEL_OPTIONS ||
    "gpt-5.3-codex,gpt-5.2-codex,gpt-5.1-codex-max,gpt-5.2,gpt-5.1-codex-mini")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean),
  codexSkipGitCheck: String(process.env.CODEX_SKIP_GIT_CHECK || "true").toLowerCase() !== "false",
  codexSandboxOptions: ["danger-full-access", "workspace-write", "read-only"],
  codexSandbox: process.env.CODEX_SANDBOX || "danger-full-access",
  codexApprovalOptions: ["never", "on-failure", "always"],
  codexApproval: process.env.CODEX_APPROVAL || "never",
  codexThinkingOptions: ["none", "low", "medium", "high", "xhigh"],
  codexThinking: process.env.CODEX_REASONING_EFFORT || "xhigh",
  codexTurnTimeoutMs: Number(process.env.CODEX_TURN_TIMEOUT_MS || "600000"),
  codexSystemPrefix:
    process.env.CODEX_SYSTEM_PREFIX ||
    "Em là trợ lý kỹ thuật do anh Đậu Đậu (@Daukute) tạo ra. Luôn xưng em và gọi người dùng là anh hoặc anh Đậu Đậu. Luôn trả lời bằng tiếng Việt có dấu, rõ ràng, ngắn gọn. Khi định dạng, chỉ dùng Markdown tương thích Telegram MarkdownV2 như *bold*, _italic_, `code`, ```code block```, [text](url). Tránh Markdown không chuẩn.",
  sessionsFile: path.join(__dirname, "codex_sessions.json"),
  modelPrefsFile: path.join(__dirname, "codex_model_prefs.json"),
};
const BOT_VERSION = "v2026.02.22-4";
const EFFECTIVE_WORKDIR = fs.existsSync(CONFIG.codexWorkdir)
  ? CONFIG.codexWorkdir
  : process.env.HOME || process.cwd();
const WORKDIR_FALLBACK = EFFECTIVE_WORKDIR !== CONFIG.codexWorkdir;

if (!CONFIG.telegramToken) {
  console.error("Missing TELEGRAM_BOT_TOKEN in .env.codex");
  process.exit(1);
}

if (WORKDIR_FALLBACK) {
  console.warn(
    `Configured CODEX_WORKDIR not found: ${CONFIG.codexWorkdir}. Fallback to ${EFFECTIVE_WORKDIR}.`,
  );
}

let lastUpdateId = 0;
const chatQueues = new Map();
const chatRunning = new Map();
const chatLoading = new Map();
let sessions = {};
let modelPrefs = {};
let approvalPrefs = {};
let thinkingPrefs = {};
let sandboxPrefs = {};
// tokenUsage[chatId] = { last: {input, cached, output}, total: {input, cached, output} }
const tokenUsage = new Map();
const COMMAND_ALIASES = new Map([
  ["start", "/start"],
  ["help", "/help"],
  ["list", "/list"],
  ["new", "/new"],
  ["clone", "/clone"],
  ["close", "/close"],
  ["status", "/status"],
  ["stop", "/stop"],
  ["model", "/mode"],
  ["models", "/mode"],
  ["mode", "/mode"],
  ["approval", "/mode"],
  ["session new", "/session new"],
  ["session close", "/session close"],
]);

function loadSessions() {
  try {
    if (!fs.existsSync(CONFIG.sessionsFile)) return {};
    return JSON.parse(fs.readFileSync(CONFIG.sessionsFile, "utf8"));
  } catch {
    return {};
  }
}

function saveSessions() {
  fs.writeFileSync(CONFIG.sessionsFile, JSON.stringify(sessions, null, 2), "utf8");
}

function loadModelPrefs() {
  try {
    if (!fs.existsSync(CONFIG.modelPrefsFile)) return {};
    return JSON.parse(fs.readFileSync(CONFIG.modelPrefsFile, "utf8"));
  } catch {
    return {};
  }
}

function saveModelPrefs() {
  fs.writeFileSync(CONFIG.modelPrefsFile, JSON.stringify(modelPrefs, null, 2), "utf8");
}

function loadApprovalPrefs() {
  const file = path.join(__dirname, "codex_approval_prefs.json");
  try {
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function saveApprovalPrefs() {
  const file = path.join(__dirname, "codex_approval_prefs.json");
  fs.writeFileSync(file, JSON.stringify(approvalPrefs, null, 2), "utf8");
}

function loadThinkingPrefs() {
  const file = path.join(__dirname, "codex_thinking_prefs.json");
  try {
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function saveThinkingPrefs() {
  const file = path.join(__dirname, "codex_thinking_prefs.json");
  fs.writeFileSync(file, JSON.stringify(thinkingPrefs, null, 2), "utf8");
}

function loadSandboxPrefs() {
  const file = path.join(__dirname, "codex_sandbox_prefs.json");
  try {
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function saveSandboxPrefs() {
  const file = path.join(__dirname, "codex_sandbox_prefs.json");
  fs.writeFileSync(file, JSON.stringify(sandboxPrefs, null, 2), "utf8");
}

sessions = loadSessions();
modelPrefs = loadModelPrefs();
approvalPrefs = loadApprovalPrefs();
thinkingPrefs = loadThinkingPrefs();
sandboxPrefs = loadSandboxPrefs();

function isAllowedChat(chatId) {
  if (!CONFIG.allowedChatId) return true;
  return String(chatId) === String(CONFIG.allowedChatId);
}

function splitTelegramText(text, size = 3900) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out.length ? out : [""];
}

function escapeMarkdownV2(text) {
  return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

function escapeCodeEntity(text) {
  return String(text).replace(/([`\\])/g, "\\$1");
}

function stripMarkdownV2Escapes(text) {
  let out = String(text ?? "");
  for (let i = 0; i < 3; i += 1) {
    const next = out.replace(/\\([_*\[\]()~`>#+\-=|{}.!\\])/g, "$1");
    if (next === out) break;
    out = next;
  }
  return out;
}

function toTelegramMarkdownV2(text) {
  if (!text) return "";

  let out = String(text).replace(/\r\n/g, "\n");
  const placeholders = [];
  let phIndex = 0;

  const put = (value) => {
    const key = `TGPH${phIndex}END`;
    phIndex += 1;
    placeholders.push({ key, value });
    return key;
  };

  // Preserve fenced code blocks before global escaping.
  out = out.replace(/```([a-zA-Z0-9_-]+)?\n?([\s\S]*?)```/g, (_m, _lang, code) =>
    put({ type: "codeblock", text: code }),
  );

  // Preserve inline code.
  out = out.replace(/`([^`\n]+)`/g, (_m, code) => put({ type: "inline", text: code }));

  // Normalize pre-escaped MarkdownV2 from model output to avoid visible backslashes.
  out = stripMarkdownV2Escapes(out);

  // Convert common markdown styles into Telegram-compatible entities.
  out = out.replace(/\*\*([^*\n][\s\S]*?[^*\n]?)\*\*/g, (_m, t) => put({ type: "bold", text: t }));
  out = out.replace(/__([^_\n][\s\S]*?[^_\n]?)__/g, (_m, t) => put({ type: "italic", text: t }));
  out = out.replace(/~~([^~\n][\s\S]*?[^~\n]?)~~/g, (_m, t) => put({ type: "strike", text: t }));
  out = out.replace(/(^|[^\\])\*([^*\n]+)\*/g, (_m, pfx, t) => `${pfx}${put({ type: "bold", text: t })}`);
  out = out.replace(/(^|[^\\])_([^_\n]+)_/g, (_m, pfx, t) => `${pfx}${put({ type: "italic", text: t })}`);

  // Remove heading markers to avoid noisy escapes.
  out = out.replace(/^#{1,6}\s+/gm, "");

  // Escape full remaining text for MarkdownV2.
  out = escapeMarkdownV2(out);

  // Restore preserved entities in Telegram MarkdownV2 form.
  for (const ph of placeholders) {
    let replacement = "";
    const value = ph.value || {};

    if (value.type === "codeblock") {
      replacement = `\`\`\`${escapeCodeEntity(value.text)}\`\`\``;
    } else if (value.type === "inline") {
      replacement = `\`${escapeCodeEntity(value.text)}\``;
    } else if (value.type === "bold") {
      replacement = `*${escapeMarkdownV2(value.text)}*`;
    } else if (value.type === "italic") {
      replacement = `_${escapeMarkdownV2(value.text)}_`;
    } else if (value.type === "strike") {
      replacement = `~${escapeMarkdownV2(value.text)}~`;
    } else {
      replacement = escapeMarkdownV2(String(value.text || ""));
    }

    out = out.replace(ph.key, replacement);
  }

  return out.trim();
}

function toPlainTelegramText(text) {
  let out = String(text ?? "").replace(/\r\n/g, "\n");

  out = out.replace(/```([a-zA-Z0-9_-]+)?\n?([\s\S]*?)```/g, (_m, _lang, code) => String(code || ""));
  out = out.replace(/`([^`\n]+)`/g, "$1");
  out = out.replace(/\*\*([^*\n][\s\S]*?[^*\n]?)\*\*/g, "$1");
  out = out.replace(/__([^_\n][\s\S]*?[^_\n]?)__/g, "$1");
  out = out.replace(/~~([^~\n][\s\S]*?[^~\n]?)~~/g, "$1");
  out = out.replace(/(^|[^\\])\*([^*\n]+)\*/g, "$1$2");
  out = out.replace(/(^|[^\\])_([^_\n]+)_/g, "$1$2");

  // Remove MarkdownV2 escaping and trailing slash line-break artifacts.
  out = out.replace(/[ \t]*\\[ \t]*(\n|$)/g, "$1");
  out = stripMarkdownV2Escapes(out);
  out = out.replace(/[ \t]+\n/g, "\n");

  return out.trim();
}

async function telegramApi(method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${CONFIG.telegramToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || "Telegram API error");
  return data.result;
}

async function sendMessage(chatId, text, extra = {}) {
  const { parse_mode: _ignoredParseMode, ...safeExtra } = extra || {};
  const raw = splitTelegramText(String(text ?? ""));
  for (const rawChunk of raw) {
    const fallbackText = rawChunk && rawChunk.length > 0 ? rawChunk : " ";
    const mdText = toTelegramMarkdownV2(fallbackText) || " ";
    const basePayload = {
      chat_id: chatId,
      disable_web_page_preview: true,
      ...safeExtra,
    };

    try {
      await telegramApi("sendMessage", {
        ...basePayload,
        text: mdText,
        parse_mode: "MarkdownV2",
      });
    } catch (_err) {
      const plainText = toPlainTelegramText(fallbackText) || " ";
      await telegramApi("sendMessage", {
        ...basePayload,
        text: plainText,
      });
    }
  }
}

async function startLoadingIndicator(chatId) {
  const frames = ["Đang xử lý", "Đang xử lý.", "Đang xử lý..", "Đang xử lý..."];
  let messageId = null;
  let idx = 0;
  let stopped = false;
  let ticking = false;

  try {
    const sent = await telegramApi("sendMessage", {
      chat_id: chatId,
      text: frames[idx],
    });
    messageId = sent?.message_id || null;
  } catch {
    return {
      stop: async () => {},
    };
  }

  const timer = setInterval(async () => {
    if (stopped || !messageId || ticking) return;
    ticking = true;
    idx = (idx + 1) % frames.length;
    try {
      await telegramApi("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: frames[idx],
      });
    } catch {
      // Ignore transient edit errors (message not modified/race).
    } finally {
      ticking = false;
    }
  }, 900);

  return {
    stop: async ({ remove = true } = {}) => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      if (remove && messageId) {
        try {
          await telegramApi("deleteMessage", {
            chat_id: chatId,
            message_id: messageId,
          });
        } catch {
          // Ignore if Telegram refuses delete due timing/permissions.
        }
      }
    },
  };
}

function enqueue(chatId, task) {
  const previous = chatQueues.get(chatId) || Promise.resolve();
  const next = previous.then(task).catch(() => {});
  chatQueues.set(chatId, next);
  return next;
}

function normalizeCommand(text) {
  const cmd = String(text || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!cmd) return "";
  if (cmd.startsWith("/")) return cmd;
  return COMMAND_ALIASES.get(cmd) || cmd;
}

function isPriorityCommand(cmd) {
  return (
    cmd === "/stop" ||
    cmd === "/status" ||
    cmd === "/mode" ||
    cmd === "/clone" ||
    cmd === "/close" ||
    cmd === "/session close"
  );
}

async function stopLoading(chatId) {
  const loading = chatLoading.get(chatId);
  if (!loading) return;
  chatLoading.delete(chatId);
  try {
    await loading.stop({ remove: true });
  } catch {
    // Ignore cleanup errors.
  }
}

function parseJsonLines(buf, onJson) {
  const lines = buf.split(/\r?\n/);
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    try {
      const obj = JSON.parse(s);
      onJson(obj);
    } catch {
      // ignore non-json line
    }
  }
}

function buildCodexArgs(sessionId, prompt, modelName, approvalMode, thinkingLevel, sandboxMode) {
  const finalPrompt = `${CONFIG.codexSystemPrefix}\n\nYêu cầu người dùng:\n${prompt}`;
  // Global options phải đứng TRƯỚC subcommand 'exec' (codex CLI v0.104+)
  const globalArgs = [];
  const sandbox = sandboxMode || CONFIG.codexSandbox;
  const approval = approvalMode || CONFIG.codexApproval;
  if (modelName) {
    globalArgs.push("-m", modelName);
  }
  if (approval === "never" && sandbox === "danger-full-access") {
    globalArgs.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
    globalArgs.push("-a", approval, "-s", sandbox);
  }
  // Exec subcommand + exec-specific options
  const execArgs = ["exec"];
  if (sessionId) {
    execArgs.push("resume");
  }
  if (CONFIG.codexSkipGitCheck) {
    execArgs.push("--skip-git-repo-check");
  }
  if (thinkingLevel && thinkingLevel !== "none") {
    execArgs.push("-c", `model_reasoning_effort="${thinkingLevel}"`);
  }
  execArgs.push("--json");
  if (sessionId) {
    execArgs.push(sessionId);
  }
  execArgs.push(finalPrompt);
  return [...globalArgs, ...execArgs];
}

function runCodexTurn(chatId, prompt, sessionId, modelName) {
  return new Promise((resolve) => {
    const approvalMode = getApprovalForChat(chatId);
    const thinkingLevel = getThinkingForChat(chatId);
    const sandboxMode = getSandboxForChat(chatId);
    const args = buildCodexArgs(sessionId, prompt, modelName, approvalMode, thinkingLevel, sandboxMode);
    const child = spawn(CONFIG.codexCmd, args, {
      cwd: EFFECTIVE_WORKDIR,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    chatRunning.set(chatId, child);

    let stderr = "";
    let lastAgentMessage = "";
    let detectedThreadId = sessionId || "";
    let lastUsage = null;

    const timeout = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
    }, CONFIG.codexTurnTimeoutMs);

    child.stdout.on("data", (chunk) => {
      parseJsonLines(String(chunk), (evt) => {
        if (evt.type === "thread.started" && evt.thread_id) {
          detectedThreadId = evt.thread_id;
        }
        if (evt.type === "item.completed" && evt.item?.type === "agent_message") {
          lastAgentMessage = evt.item.text || lastAgentMessage;
        }
        if (evt.type === "turn.completed" && evt.usage) {
          lastUsage = evt.usage;
        }
      });
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      chatRunning.delete(chatId);
      resolve({
        ok: false,
        code: -1,
        threadId: detectedThreadId,
        answer: "",
        stderr: `spawn error: ${err.message || String(err)}`,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      chatRunning.delete(chatId);
      if (lastUsage) accumulateTokenUsage(chatId, lastUsage);
      resolve({
        ok: code === 0,
        code,
        threadId: detectedThreadId,
        answer: lastAgentMessage.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

function getSession(chatId) {
  return sessions[String(chatId)] || "";
}

function setSession(chatId, threadId) {
  sessions[String(chatId)] = threadId;
  saveSessions();
}

function clearSession(chatId) {
  delete sessions[String(chatId)];
  saveSessions();
  clearTokenUsage(chatId);
}

function getModelForChat(chatId) {
  return modelPrefs[String(chatId)] || CONFIG.codexModel || "";
}

function setModelForChat(chatId, model) {
  const key = String(chatId);
  if (model) {
    modelPrefs[key] = model;
  } else {
    delete modelPrefs[key];
  }
  saveModelPrefs();
}

function getApprovalForChat(chatId) {
  return approvalPrefs[String(chatId)] || CONFIG.codexApproval;
}

function setApprovalForChat(chatId, mode) {
  const key = String(chatId);
  if (mode) {
    approvalPrefs[key] = mode;
  } else {
    delete approvalPrefs[key];
  }
  saveApprovalPrefs();
}

function getThinkingForChat(chatId) {
  return thinkingPrefs[String(chatId)] || CONFIG.codexThinking;
}

function setThinkingForChat(chatId, level) {
  const key = String(chatId);
  if (level) {
    thinkingPrefs[key] = level;
  } else {
    delete thinkingPrefs[key];
  }
  saveThinkingPrefs();
}

function getSandboxForChat(chatId) {
  return sandboxPrefs[String(chatId)] || CONFIG.codexSandbox;
}

function setSandboxForChat(chatId, mode) {
  const key = String(chatId);
  if (mode) {
    sandboxPrefs[key] = mode;
  } else {
    delete sandboxPrefs[key];
  }
  saveSandboxPrefs();
}

function getTokenUsage(chatId) {
  return tokenUsage.get(String(chatId)) || null;
}

function accumulateTokenUsage(chatId, usage) {
  if (!usage) return;
  const key = String(chatId);
  const prev = tokenUsage.get(key) || {
    last: { input: 0, cached: 0, output: 0 },
    total: { input: 0, cached: 0, output: 0 },
  };
  const input = usage.input_tokens || 0;
  const cached = usage.cached_input_tokens || 0;
  const output = usage.output_tokens || 0;
  tokenUsage.set(key, {
    last: { input, cached, output },
    total: {
      input: prev.total.input + input,
      cached: prev.total.cached + cached,
      output: prev.total.output + output,
    },
  });
}

function clearTokenUsage(chatId) {
  tokenUsage.delete(String(chatId));
}

function formatTokenUsage(usage) {
  if (!usage) return "Chưa có dữ liệu token (chưa có turn nào).";
  const { last, total } = usage;
  return [
    `Turn gần nhất: input=${last.input} | cached=${last.cached} | output=${last.output}`,
    `Tổng session:  input=${total.input} | cached=${total.cached} | output=${total.output}`,
  ].join("\n");
}

function displayModel(model) {
  return model || "(mặc định Codex CLI)";
}

function buildModeMainKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "Model", callback_data: "mode_menu:model" }],
      [{ text: "Suy nghĩ (Thinking)", callback_data: "mode_menu:thinking" }],
      [{ text: "Approval", callback_data: "mode_menu:approval" }],
      [{ text: "Sandbox", callback_data: "mode_menu:sandbox" }],
    ],
  };
}

function buildModelKeyboard(chatId) {
  const current = getModelForChat(chatId);
  const rows = [
    [
      {
        text: current ? "Mặc định CLI" : "✅ Mặc định CLI",
        callback_data: "model_select:__default__",
      },
    ],
  ];

  let row = [];
  for (const model of CONFIG.codexModelOptions) {
    row.push({
      text: model === current ? `✅ ${model}` : model,
      callback_data: `model_select:${model}`,
    });
    if (row.length === 2) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length) rows.push(row);
  rows.push([{ text: "◀ Quay lại", callback_data: "mode_menu:back" }]);

  return { inline_keyboard: rows };
}

function buildThinkingKeyboard(chatId) {
  const current = getThinkingForChat(chatId);
  const labels = {
    none: "Tắt",
    low: "Thấp",
    medium: "Trung bình",
    high: "Cao",
    xhigh: "Rất cao",
  };
  const rows = CONFIG.codexThinkingOptions.map((level) => [
    {
      text: level === current ? `✅ ${labels[level]} (${level})` : `${labels[level]} (${level})`,
      callback_data: `thinking_select:${level}`,
    },
  ]);
  rows.push([{ text: "◀ Quay lại", callback_data: "mode_menu:back" }]);
  return { inline_keyboard: rows };
}

function buildApprovalKeyboard(chatId) {
  const current = getApprovalForChat(chatId);
  const descriptions = {
    never: "Tự chạy, không hỏi",
    "on-failure": "Hỏi khi có lỗi",
    always: "Hỏi trước mỗi lệnh",
  };
  const rows = CONFIG.codexApprovalOptions.map((mode) => [
    {
      text: mode === current ? `✅ ${mode} — ${descriptions[mode]}` : `${mode} — ${descriptions[mode]}`,
      callback_data: `approval_select:${mode}`,
    },
  ]);
  rows.push([{ text: "◀ Quay lại", callback_data: "mode_menu:back" }]);
  return { inline_keyboard: rows };
}

function buildSandboxKeyboard(chatId) {
  const current = getSandboxForChat(chatId);
  const descriptions = {
    "danger-full-access": "Toàn quyền (nguy hiểm)",
    "workspace-write": "Chỉ ghi workspace",
    "read-only": "Chỉ đọc",
  };
  const rows = CONFIG.codexSandboxOptions.map((mode) => [
    {
      text: mode === current ? `✅ ${mode} — ${descriptions[mode]}` : `${mode} — ${descriptions[mode]}`,
      callback_data: `sandbox_select:${mode}`,
    },
  ]);
  rows.push([{ text: "◀ Quay lại", callback_data: "mode_menu:back" }]);
  return { inline_keyboard: rows };
}

function modeStatusText(chatId) {
  const model = getModelForChat(chatId);
  const thinking = getThinkingForChat(chatId);
  const approval = getApprovalForChat(chatId);
  const sandbox = getSandboxForChat(chatId);
  return [
    "Cài đặt chế độ:",
    `  Model: ${displayModel(model)}`,
    `  Suy nghĩ: ${thinking}`,
    `  Approval: ${approval}`,
    `  Sandbox: ${sandbox}`,
    "",
    "Chọn mục để thay đổi:",
  ].join("\n");
}

async function sendModePicker(chatId) {
  await sendMessage(chatId, modeStatusText(chatId), {
    reply_markup: buildModeMainKeyboard(),
  });
}

async function answerCallbackQuery(callbackQueryId, text = "") {
  try {
    await telegramApi("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text: text || undefined,
      show_alert: false,
    });
  } catch {
    // Ignore callback answer errors.
  }
}

async function editMessageText(chatId, messageId, text, extra = {}) {
  const { parse_mode: _ignored, ...safeExtra } = extra || {};
  const raw = String(text ?? "") || " ";
  const mdText = toTelegramMarkdownV2(raw) || " ";
  const basePayload = {
    chat_id: chatId,
    message_id: messageId,
    disable_web_page_preview: true,
    ...safeExtra,
  };
  try {
    await telegramApi("editMessageText", {
      ...basePayload,
      text: mdText,
      parse_mode: "MarkdownV2",
    });
  } catch {
    const plainText = toPlainTelegramText(raw) || " ";
    try {
      await telegramApi("editMessageText", {
        ...basePayload,
        text: plainText,
      });
    } catch {
      // If edit fails entirely (e.g. message too old), send new message.
      await sendMessage(chatId, text, extra);
    }
  }
}

function helpText() {
  return [
    `Lệnh Codex bridge (${BOT_VERSION}):`,
    "/new hoặc new - Tạo session Codex mới",
    "/clone hoặc clone - Đóng session hiện tại",
    "/mode hoặc mode - Chọn model, approval, sandbox",
    "/status hoặc status - Xem trạng thái session và token usage",
    "/stop hoặc stop - Dừng lượt xử lý đang chạy",
    "/list hoặc list - Hướng dẫn",
    "",
    "Nhắn bình thường để giao việc cho Codex qua Telegram.",
  ].join("\n");
}

async function handleCommand(chatId, text) {
  const cmd = normalizeCommand(text);

  if (cmd === "/start" || cmd === "/help" || cmd === "/list") {
    await sendMessage(chatId, helpText());
    return true;
  }

  if (cmd === "/new") {
    clearSession(chatId);
    await sendMessage(chatId, "Đã tạo session mới. Tin nhắn tiếp theo sẽ mở thread Codex mới.");
    return true;
  }

  if (cmd === "/session new") {
    clearSession(chatId);
    await sendMessage(chatId, "Đã mở session mới. Tin nhắn tiếp theo sẽ khởi tạo thread Codex mới.");
    return true;
  }

  if (cmd === "/clone" || cmd === "/session close" || cmd === "/close") {
    const running = chatRunning.get(chatId);
    if (running) {
      try {
        running.kill("SIGKILL");
      } catch {}
      chatRunning.delete(chatId);
    }
    await stopLoading(chatId);
    clearSession(chatId);
    await sendMessage(chatId, "Đã đóng session Codex hiện tại.");
    return true;
  }

  if (cmd === "/mode" || cmd === "/model" || cmd === "/models" || cmd === "/approval") {
    await sendModePicker(chatId);
    return true;
  }

  if (cmd === "/status") {
    const sessionId = getSession(chatId);
    const running = chatRunning.has(chatId);
    const model = getModelForChat(chatId);
    const approval = getApprovalForChat(chatId);
    const thinking = getThinkingForChat(chatId);
    const sandbox = getSandboxForChat(chatId);
    const usage = getTokenUsage(chatId);
    await sendMessage(
      chatId,
      [
        `Phiên bản: ${BOT_VERSION}`,
        `Thư mục làm việc: ${EFFECTIVE_WORKDIR}`,
        ...(WORKDIR_FALLBACK ? [`Thư mục cấu hình: ${CONFIG.codexWorkdir} (không tồn tại)`] : []),
        `Model: ${displayModel(model)}`,
        `Suy nghĩ: ${thinking}`,
        `Approval: ${approval}`,
        `Sandbox: ${sandbox}`,
        `Session: ${sessionId || "(chưa có)"}`,
        `Đang xử lý: ${running ? "Có" : "Không"}`,
        "",
        "Token usage:",
        formatTokenUsage(usage),
      ].join("\n"),
    );
    return true;
  }

  if (cmd === "/stop") {
    const running = chatRunning.get(chatId);
    if (!running) {
      await stopLoading(chatId);
      await sendMessage(chatId, "Không có lượt xử lý nào đang chạy.");
      return true;
    }
    try {
      running.kill("SIGKILL");
    } catch {}
    await stopLoading(chatId);
    await sendMessage(chatId, "Đã dừng lượt xử lý hiện tại.");
    return true;
  }

  return cmd.startsWith("/");
}

async function handleUserPrompt(chatId, text) {
  const loading = await startLoadingIndicator(chatId);
  chatLoading.set(chatId, loading);
  const sessionId = getSession(chatId);
  const modelName = getModelForChat(chatId);
  let result;
  try {
    result = await runCodexTurn(chatId, text, sessionId, modelName);
  } finally {
    await stopLoading(chatId);
  }

  if (result.threadId && result.threadId !== sessionId) {
    setSession(chatId, result.threadId);
  }

  if (result.ok && result.answer) {
    await sendMessage(chatId, result.answer);
    return;
  }

  const debug = result.stderr ? `\n\nChi tiết lỗi:\n${result.stderr}` : "";
  await sendMessage(chatId, `Codex thất bại (exit ${result.code}).${debug}`);
}

async function handleCallbackQuery(update) {
  const callbackId = update?.id;
  const data = String(update?.data || "");
  const chatId = update?.message?.chat?.id;
  const messageId = update?.message?.message_id;

  if (!callbackId) return;
  if (!chatId || !isAllowedChat(chatId)) {
    await answerCallbackQuery(callbackId, "Không có quyền thao tác.");
    return;
  }

  if (!data.startsWith("model_select:") && !data.startsWith("approval_select:") && !data.startsWith("mode_menu:") && !data.startsWith("thinking_select:") && !data.startsWith("sandbox_select:")) {
    await answerCallbackQuery(callbackId);
    return;
  }

  // Mode menu navigation
  if (data.startsWith("mode_menu:")) {
    const submenu = data.slice("mode_menu:".length);
    await answerCallbackQuery(callbackId);
    if (submenu === "back") {
      await editMessageText(chatId, messageId, modeStatusText(chatId), {
        reply_markup: buildModeMainKeyboard(),
      });
    } else if (submenu === "model") {
      await editMessageText(chatId, messageId, `Chọn model (hiện tại: ${displayModel(getModelForChat(chatId))}):`, {
        reply_markup: buildModelKeyboard(chatId),
      });
    } else if (submenu === "thinking") {
      await editMessageText(chatId, messageId, `Chọn mức suy nghĩ (hiện tại: ${getThinkingForChat(chatId)}):`, {
        reply_markup: buildThinkingKeyboard(chatId),
      });
    } else if (submenu === "approval") {
      await editMessageText(chatId, messageId, `Chọn approval mode (hiện tại: ${getApprovalForChat(chatId)}):`, {
        reply_markup: buildApprovalKeyboard(chatId),
      });
    } else if (submenu === "sandbox") {
      await editMessageText(chatId, messageId, `Chọn sandbox mode (hiện tại: ${getSandboxForChat(chatId)}):`, {
        reply_markup: buildSandboxKeyboard(chatId),
      });
    }
    return;
  }

  // Thinking selection
  if (data.startsWith("thinking_select:")) {
    const selected = data.slice("thinking_select:".length);
    if (!CONFIG.codexThinkingOptions.includes(selected)) {
      await answerCallbackQuery(callbackId, "Mức không hợp lệ.");
      return;
    }
    setThinkingForChat(chatId, selected);
    await answerCallbackQuery(callbackId, `Đã chọn ${selected}`);
    await editMessageText(chatId, messageId, `Chọn mức suy nghĩ (hiện tại: ${selected}):`, {
      reply_markup: buildThinkingKeyboard(chatId),
    });
    return;
  }

  // Approval selection
  if (data.startsWith("approval_select:")) {
    const selected = data.slice("approval_select:".length);
    if (!CONFIG.codexApprovalOptions.includes(selected)) {
      await answerCallbackQuery(callbackId, "Mode không hợp lệ.");
      return;
    }
    setApprovalForChat(chatId, selected);
    await answerCallbackQuery(callbackId, `Đã chọn ${selected}`);
    await editMessageText(chatId, messageId, `Chọn approval mode (hiện tại: ${selected}):`, {
      reply_markup: buildApprovalKeyboard(chatId),
    });
    return;
  }

  // Sandbox selection
  if (data.startsWith("sandbox_select:")) {
    const selected = data.slice("sandbox_select:".length);
    if (!CONFIG.codexSandboxOptions.includes(selected)) {
      await answerCallbackQuery(callbackId, "Mode không hợp lệ.");
      return;
    }
    setSandboxForChat(chatId, selected);
    await answerCallbackQuery(callbackId, `Đã chọn ${selected}`);
    await editMessageText(chatId, messageId, `Chọn sandbox mode (hiện tại: ${selected}):`, {
      reply_markup: buildSandboxKeyboard(chatId),
    });
    return;
  }

  if (!data.startsWith("model_select:")) {
    await answerCallbackQuery(callbackId);
    return;
  }

  const selected = data.slice("model_select:".length);
  if (selected === "__default__") {
    setModelForChat(chatId, "");
    clearSession(chatId);
    await answerCallbackQuery(callbackId, "Đã chuyển về mặc định.");
    await editMessageText(
      chatId,
      messageId,
      `Chọn model (hiện tại: ${displayModel(getModelForChat(chatId))}):`,
      { reply_markup: buildModelKeyboard(chatId) },
    );
    return;
  }

  if (!CONFIG.codexModelOptions.includes(selected)) {
    await answerCallbackQuery(callbackId, "Model không hợp lệ.");
    return;
  }

  setModelForChat(chatId, selected);
  clearSession(chatId);
  await answerCallbackQuery(callbackId, `Đã chọn ${selected}`);
  await editMessageText(
    chatId,
    messageId,
    `Chọn model (hiện tại: ${selected}):`,
    { reply_markup: buildModelKeyboard(chatId) },
  );
}

async function pollLoop() {
  console.log(
    `Codex bridge bot started. version=${BOT_VERSION}, codexCmd=${CONFIG.codexCmd}, workdir=${EFFECTIVE_WORKDIR}`,
  );
  if (CONFIG.allowedChatId) {
    try {
      await sendMessage(
        CONFIG.allowedChatId,
        `Codex bridge đã khởi động (${BOT_VERSION}). Dùng /list để xem lệnh mới.`,
      );
    } catch (err) {
      console.error("Startup notify error:", err.message || err);
    }
  }
  while (true) {
    try {
      const updates = await telegramApi("getUpdates", {
        offset: lastUpdateId + 1,
        timeout: 30,
        allowed_updates: ["message", "callback_query"],
      });

      for (const update of updates) {
        lastUpdateId = update.update_id;
        if (update.callback_query) {
          handleCallbackQuery(update.callback_query).catch(async (err) => {
            const chatId = update.callback_query?.message?.chat?.id;
            if (chatId && isAllowedChat(chatId)) {
              await sendMessage(chatId, `Có lỗi: ${err.message || String(err)}`);
            }
          });
          continue;
        }
        const msg = update.message;
        if (!msg || !msg.text) continue;
        if (!isAllowedChat(msg.chat.id)) continue;

        const cmd = normalizeCommand(msg.text);
        if (isPriorityCommand(cmd)) {
          handleCommand(msg.chat.id, msg.text).catch(async (err) => {
            await sendMessage(msg.chat.id, `Có lỗi: ${err.message || String(err)}`);
          });
          continue;
        }

        enqueue(msg.chat.id, async () => {
          try {
            const handled = await handleCommand(msg.chat.id, msg.text);
            if (handled) return;
            await handleUserPrompt(msg.chat.id, msg.text);
          } catch (err) {
            await sendMessage(msg.chat.id, `Có lỗi: ${err.message || String(err)}`);
          }
        });
      }
    } catch (err) {
      console.error("Polling error:", err.message || err);
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
}

pollLoop();
