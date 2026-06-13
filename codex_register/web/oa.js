const $ = (selector) => document.querySelector(selector);

let emails = [];
let ats = [];
let tasks = [];
let selectedTaskId = "";
let configCache = null;

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2800);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function badge(status) {
  const cls = String(status || "").toLowerCase();
  const map = {
    queued: "排队",
    running: "运行",
    success: "成功",
    failed: "失败",
    canceled: "已取消",
  };
  return `<span class="badge ${cls}">${map[cls] || escapeHtml(status || "-")}</span>`;
}

function fmtTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function maskSecret(value, head = 8, tail = 8) {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= head + tail + 3) return `${text.slice(0, 2)}***`;
  return `${text.slice(0, head)}...${text.slice(-tail)}`;
}

function shortHash(hash) {
  return hash ? hash.slice(0, 10) : "";
}

function taskName(task) {
  return task.title || task.id.replace(/^oa_/, "");
}

function mailboxPreview(url) {
  if (!url) return "本地 Hotmail refresh_token";
  try {
    const parsed = new URL(maskMailboxUrl(url));
    return `${parsed.origin}${parsed.pathname}${parsed.search ? "?..." : ""}`;
  } catch {
    const text = String(url);
    return text.length > 80 ? `${text.slice(0, 64)}...` : text;
  }
}

function maskMailboxUrl(value) {
  const text = String(value || "");
  if (!text) return "";
  try {
    const url = new URL(text);
    for (const [key, current] of url.searchParams.entries()) {
      if (/token|secret|password|pass|key/i.test(key) || current.length > 48) {
        url.searchParams.set(key, maskSecret(current, 12, 8));
      }
    }
    return url.toString();
  } catch {
    return text.length > 160 ? maskSecret(text, 80, 40) : text;
  }
}

function emailParts(item) {
  if (item.mailboxUrl) {
    try {
      const url = new URL(item.mailboxUrl);
      return {
        password: "",
        clientId: url.searchParams.get("clientId") || "",
        refreshToken: url.searchParams.get("refreshToken") || "",
      };
    } catch {
      return {password: "", clientId: "", refreshToken: ""};
    }
  }
  const raw = String(item.raw || "");
  const parts = raw.split(/\s*-{4,}\s*|\t|,/).map((part) => part.trim()).filter(Boolean);
  const emailIndex = parts.findIndex((part) => part.toLowerCase() === String(item.email || "").toLowerCase());
  const tail = emailIndex >= 0 ? parts.slice(emailIndex + 1) : parts.slice(1);
  return {
    password: tail[0] || "",
    clientId: tail[1] || "",
    refreshToken: tail.slice(2).join("----"),
  };
}

function emailStatus(item) {
  if (item.assignedTaskId) {
    const status = item.assignedTaskStatus === "running" ? "运行占用" : "排队占用";
    return {cls: "queued", text: status};
  }
  if (item.available) return {cls: "success", text: "空闲"};
  if (item.bindStatus === "bound") return {cls: "success", text: "已接入"};
  if (item.bindStatus === "reserved") return {cls: "queued", text: "已预占"};
  if (item.bindStatus === "failed") return {cls: "warn", text: "失败可重试"};
  if (item.bindStatus === "canceled") return {cls: "warn", text: "已取消可重试"};
  if (item.bindStatus === "disabled") return {cls: "failed", text: "停用"};
  if (item.kind === "hotmail") return {cls: "warn", text: "不可用"};
  if (isPlaceholderMailboxUrl(item.mailboxUrl)) return {cls: "warn", text: "接码域名占位"};
  return {cls: "warn", text: "不可用"};
}

function emailStatusBadge(item) {
  const status = emailStatus(item);
  return `<span class="badge ${status.cls}">${escapeHtml(status.text)}</span>`;
}

function isPlaceholderMailboxUrl(value) {
  if (!value) return false;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "mail-api.example" || host.endsWith(".example") || host === "example.com" || host.endsWith(".example.com");
  } catch {
    return false;
  }
}

function emailTypeText(item) {
  if (item.kind === "hotmail") return "Hotmail refresh_token";
  return "HTTP 接码 URL";
}

function emailTypeShort(item) {
  return item.kind === "hotmail" ? "HM" : "URL";
}

function emailStatusOption(value, label, current) {
  return `<option value="${value}" ${current === value ? "selected" : ""}>${label}</option>`;
}

function emailCard(item) {
  return `
    <div class="email-row" data-email-index="${item.index}" title="点击查看邮箱详情">
      <span class="email-index">${item.index + 1}</span>
      <strong class="email-main mono truncate">${escapeHtml(item.email)}</strong>
      <span class="email-row-meta">
        <span class="badge" title="${escapeHtml(emailTypeText(item))}">${escapeHtml(emailTypeShort(item))}</span>
        <button class="ghost small email-delete" type="button" title="删除邮箱" aria-label="删除邮箱" data-delete-email="${encodeURIComponent(item.email)}">×</button>
      </span>
    </div>
  `;
}

function renderEmails() {
  const availableCount = emails.filter((item) => item.available).length;
  const assignedCount = emails.filter((item) => item.assignedTaskId).length;
  const hotmailCount = emails.filter((item) => item.kind === "hotmail").length;
  const preview = emails.slice(0, 12);
  $("#email-count").textContent = emails.length;
  $("#emails").innerHTML = emails.length
    ? `
      <div class="email-mini-summary" data-open-email-pool>
        <span>可用 <strong>${availableCount}</strong></span>
        <span>占用 <strong>${assignedCount}</strong></span>
        <span>HM <strong>${hotmailCount}</strong></span>
      </div>
      ${preview.map(emailCard).join("")}
      ${emails.length > preview.length ? `<button class="wide small" type="button" data-open-email-pool>查看全部 ${emails.length} 个邮箱</button>` : ""}
    `
    : `<div class="empty">暂无邮箱池，先导入“邮箱----密码----clientId----refreshToken”。</div>`;
  if (!$("#email-list-modal").classList.contains("hidden")) renderEmailPoolModal();
}

function openEmailModal(item) {
  const parts = emailParts(item);
  const status = emailStatus(item);
  const bindStatus = item.bindStatus || "free";
  const currentPhone = item.assignedPhone || (["reserved", "bound"].includes(bindStatus) ? item.bindPhone : "");
  const relatedPhone = item.bindPhone || item.assignedPhone || "";
  const mailbox = item.mailboxUrl
    ? maskMailboxUrl(item.mailboxUrl)
    : "本地 Hotmail Provider：使用 clientId + refresh_token 直接读取 Outlook 收件箱";
  $("#email-modal-title").textContent = item.email;
  $("#email-modal-subtitle").textContent = `#${item.index + 1} / ${emailTypeText(item)} / ${status.text}`;
  $("#email-detail").innerHTML = `
    <div class="email-detail-grid">
    <div class="email-detail-item wide">
      <span class="label">邮箱</span>
      <strong>${escapeHtml(item.email)}</strong>
    </div>
    <div class="email-detail-item">
      <span class="label">状态</span>
      <strong>${escapeHtml(status.text)}${currentPhone ? ` · ${escapeHtml(currentPhone)}` : ""}</strong>
    </div>
    <div class="email-detail-item">
      <span class="label">${["reserved", "bound"].includes(bindStatus) ? "接入手机号" : "相关手机号"}</span>
      <strong>${escapeHtml(relatedPhone || "-")}</strong>
    </div>
    <div class="email-detail-item">
      <span class="label">接入状态</span>
      <strong>${escapeHtml(bindStatus)}</strong>
    </div>
    ${item.bindSub2ApiAccount ? `<div class="email-detail-item"><span class="label">SUB2API 账号</span><div class="mono wrap">${escapeHtml(item.bindSub2ApiAccount)}</div></div>` : ""}
    ${item.bindAccessTokenHash ? `<div class="email-detail-item"><span class="label">AT hash</span><div class="mono wrap">${escapeHtml(item.bindAccessTokenHash)}</div></div>` : ""}
    ${item.bindUpdatedAt ? `<div class="email-detail-item"><span class="label">状态更新时间</span><div class="mono wrap">${escapeHtml(fmtTime(item.bindUpdatedAt))}</div></div>` : ""}
    ${item.bindError ? `<div class="email-detail-item wide"><span class="label">错误</span><div class="mono wrap error-text">${escapeHtml(item.bindError)}</div></div>` : ""}
    <div class="email-detail-item">
      <span class="label">接码方式</span>
      <strong>${escapeHtml(emailTypeText(item))}</strong>
    </div>
    <div class="email-detail-item wide">
      <span class="label">接码地址 / 来源</span>
      <div class="mono wrap">${escapeHtml(mailbox)}</div>
    </div>
    ${parts.password ? `<div class="email-detail-item"><span class="label">邮箱密码</span><div class="mono wrap">${escapeHtml(maskSecret(parts.password, 3, 3))}</div></div>` : ""}
    ${parts.clientId ? `<div class="email-detail-item"><span class="label">clientId</span><div class="mono wrap">${escapeHtml(parts.clientId)}</div></div>` : ""}
    ${parts.refreshToken ? `<div class="email-detail-item wide"><span class="label">refreshToken</span><div class="mono wrap">${escapeHtml(maskSecret(parts.refreshToken, 16, 12))}</div></div>` : ""}
    ${item.assignedTaskId ? `<div class="email-detail-item wide"><span class="label">当前任务</span><div class="mono wrap">${escapeHtml(item.assignedTaskId)}</div></div>` : ""}
    <div class="email-detail-item wide">
      <span class="label">原始行预览</span>
      <div class="mono wrap">${escapeHtml(maskSecret(item.raw || item.preview || "", 48, 36))}</div>
    </div>
    <form class="email-detail-item wide email-status-form" data-email-status-form data-email="${encodeURIComponent(item.email)}">
      <span class="label">手动设置邮箱接入状态</span>
      <div class="split">
        <div class="field">
          <label>状态</label>
          <select name="status">
            ${emailStatusOption("free", "空闲", bindStatus)}
            ${emailStatusOption("reserved", "预占", bindStatus)}
            ${emailStatusOption("bound", "已接入", bindStatus)}
            ${emailStatusOption("failed", "失败可重试", bindStatus)}
            ${emailStatusOption("canceled", "已取消可重试", bindStatus)}
            ${emailStatusOption("disabled", "停用", bindStatus)}
          </select>
        </div>
        <div class="field">
          <label>接入手机号</label>
          <input name="phone" value="${escapeHtml(relatedPhone)}" placeholder="+123456789">
        </div>
      </div>
      <div class="split">
        <div class="field">
          <label>任务 ID</label>
          <input name="taskId" value="${escapeHtml(item.bindTaskId || item.assignedTaskId || "")}">
        </div>
        <div class="field">
          <label>SUB2API 账号</label>
          <input name="sub2apiAccount" value="${escapeHtml(item.bindSub2ApiAccount || "")}">
        </div>
      </div>
      <div class="field">
        <label>备注/错误</label>
        <input name="note" value="${escapeHtml(item.bindNote || item.bindError || "")}">
      </div>
      <button class="primary" type="submit">保存邮箱状态</button>
    </form>
    </div>
  `;
  $("#email-modal").classList.remove("hidden");
  bindEmailStatusForm();
}

function closeEmailModal() {
  $("#email-modal").classList.add("hidden");
}

function emailPoolTableRow(item) {
  const assigned = item.assignedTaskId
    ? `<div class="muted mono">${escapeHtml(item.assignedTaskId)}</div>`
    : "";
  const phone = item.bindPhone || item.assignedPhone || "";
  const encodedEmail = encodeURIComponent(item.email);
  return `
    <tr class="selectable" data-email-index="${item.index}">
      <td><span class="email-index">${item.index + 1}</span></td>
      <td>
        <div class="mono">${escapeHtml(item.email)}</div>
        ${assigned}
      </td>
      <td><div class="mono">${escapeHtml(phone || "-")}</div></td>
      <td>${emailStatusBadge(item)}</td>
      <td><span class="badge">${escapeHtml(emailTypeText(item))}</span></td>
      <td><div class="mono wrap">${escapeHtml(mailboxPreview(item.mailboxUrl))}</div></td>
      <td>
        <div class="row actions email-quick-actions">
          <button class="small" type="button" data-email-status="${encodedEmail}" data-status="bound">设已接入</button>
          <button class="ghost small" type="button" data-email-status="${encodedEmail}" data-status="free">释放</button>
          <button class="ghost small" type="button" data-email-status="${encodedEmail}" data-status="disabled">停用</button>
          <button class="danger small" type="button" data-delete-email="${encodedEmail}">删除</button>
        </div>
      </td>
    </tr>
  `;
}

function renderEmailPoolModal() {
  const availableCount = emails.filter((item) => item.available).length;
  const assignedCount = emails.filter((item) => item.assignedTaskId).length;
  const hotmailCount = emails.filter((item) => item.kind === "hotmail").length;
  const urlCount = emails.filter((item) => item.kind !== "hotmail").length;
  $("#email-list-modal-subtitle").textContent = `共 ${emails.length} 个；空闲 ${availableCount} 个；任务占用 ${assignedCount} 个；Hotmail ${hotmailCount} 个；URL ${urlCount} 个`;
  $("#email-pool-list").innerHTML = emails.length
    ? `
      <div class="table-wrap email-pool-table-wrap">
        <table class="email-pool-table">
          <thead>
            <tr>
              <th>#</th>
              <th>邮箱</th>
              <th>接入号码</th>
              <th>状态</th>
              <th>类型</th>
              <th>接码地址</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>${emails.map(emailPoolTableRow).join("")}</tbody>
        </table>
      </div>
    `
    : `<div class="empty">暂无邮箱池。</div>`;
  bindEmailActions($("#email-list-modal"));
}

function openEmailListModal() {
  renderEmailPoolModal();
  $("#email-list-modal").classList.remove("hidden");
  bindEmailActions($("#email-list-modal"));
}

function closeEmailListModal() {
  $("#email-list-modal").classList.add("hidden");
}

function findEmailByEncoded(encodedEmail) {
  return emails.find((entry) => encodeURIComponent(entry.email) === encodedEmail);
}

function normalizePhoneInput(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const compact = text.replace(/[\s()-]/g, "");
  if (compact.startsWith("+")) {
    const digits = compact.slice(1).replace(/[^\d]/g, "");
    return digits ? `+${digits}` : "";
  }
  const digits = compact.replace(/[^\d]/g, "");
  return digits ? `+${digits}` : "";
}

function promptBoundPhone(item) {
  const current = item?.bindPhone || item?.assignedPhone || "";
  const value = window.prompt("设置为已接入，请填写接入手机号（带国家码，例如 +49123456789）：", current);
  if (value === null) return null;
  const phone = normalizePhoneInput(value);
  if (!phone) {
    toast("设置已接入必须填写手机号");
    return null;
  }
  return phone;
}

function bindEmailStatusForm() {
  const form = document.querySelector("[data-email-status-form]");
  if (!form || form.dataset.boundStatusForm === "1") return;
  form.dataset.boundStatusForm = "1";
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    if (data.status === "bound") {
      data.phone = normalizePhoneInput(data.phone);
      if (!data.phone) {
        toast("设置已接入必须填写手机号");
        form.querySelector("[name=phone]")?.focus();
        return;
      }
    }
    try {
      await api(`/api/oa/emails/${form.dataset.email}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
      toast("邮箱状态已保存");
      await loadEmails();
      const item = emails.find((entry) => encodeURIComponent(entry.email) === form.dataset.email);
      if (item) openEmailModal(item);
    } catch (error) {
      toast(error.message);
    }
  });
}

function bindEmailActions(root = document) {
  root.querySelectorAll("[data-open-email-pool]").forEach((el) => {
    if (el.dataset.boundEmailPool === "1") return;
    el.dataset.boundEmailPool = "1";
    el.addEventListener("click", openEmailListModal);
  });

  root.querySelectorAll("[data-delete-email]").forEach((btn) => {
    if (btn.dataset.boundDeleteEmail === "1") return;
    btn.dataset.boundDeleteEmail = "1";
    btn.addEventListener("click", async (event) => {
      event.stopPropagation();
      await api(`/api/oa/emails/${btn.dataset.deleteEmail}`, {method: "DELETE"});
      toast("邮箱已删除");
      await loadEmails();
    });
  });

  root.querySelectorAll("[data-email-status]").forEach((btn) => {
    if (btn.dataset.boundEmailStatus === "1") return;
    btn.dataset.boundEmailStatus = "1";
    btn.addEventListener("click", async (event) => {
      event.stopPropagation();
      const status = btn.dataset.status || "free";
      const body = {status};
      if (status === "bound") {
        const item = findEmailByEncoded(btn.dataset.emailStatus);
        const phone = promptBoundPhone(item);
        if (!phone) return;
        body.phone = phone;
      }
      await api(`/api/oa/emails/${btn.dataset.emailStatus}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      toast(status === "bound" ? "邮箱已标记为已接入" : status === "free" ? "邮箱已释放为可用" : "邮箱已停用");
      await loadEmails();
      if (!$("#email-list-modal").classList.contains("hidden")) renderEmailPoolModal();
    });
  });

  root.querySelectorAll("[data-email-index]").forEach((row) => {
    if (row.dataset.boundEmailOpen === "1") return;
    row.dataset.boundEmailOpen = "1";
    row.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      const item = emails.find((entry) => String(entry.index) === row.dataset.emailIndex);
      if (item) openEmailModal(item);
    });
  });
}

async function loadEmails() {
  const data = await api("/api/oa/emails");
  emails = data.items || [];
  $("#email-file").textContent = data.file || "";
  renderEmails();
  bindEmailActions();
}

function oaAtModeText(item) {
  const mode = item.oa?.mode || "auto";
  if (mode === "enabled") return "手动接入";
  if (mode === "disabled") return "不接入";
  return item.phone ? "自动接入" : "无手机号";
}

function oaAtModeClass(item) {
  if (!item.phone) return "failed";
  if (item.oa?.mode === "disabled") return "warn";
  return "success";
}

function oaAtRow(item) {
  return `
    <div class="oa-at-row ${item.oa?.eligible ? "eligible" : "disabled"}">
      <div class="oa-at-main">
        <div class="mono truncate">${escapeHtml(item.phone || item.email || item.preview)}</div>
        <div class="muted mono truncate">${escapeHtml(shortHash(item.hash))} · ${escapeHtml(item.plan || "-")}</div>
      </div>
      <span class="badge ${oaAtModeClass(item)}">${escapeHtml(oaAtModeText(item))}</span>
      <select class="oa-at-select" data-at-oa="${escapeHtml(item.hash)}">
        <option value="auto" ${item.oa?.mode === "auto" ? "selected" : ""}>自动</option>
        <option value="true" ${item.oa?.mode === "enabled" ? "selected" : ""}>接入</option>
        <option value="false" ${item.oa?.mode === "disabled" ? "selected" : ""}>不接入</option>
      </select>
    </div>
  `;
}

function renderOaAts() {
  const el = $("#oa-at-list");
  if (!el) return;
  const phoneAts = ats.filter((item) => item.phone);
  const enabledCount = phoneAts.filter((item) => item.oa?.eligible).length;
  el.innerHTML = ats.length
    ? `
      <div class="oa-at-summary">
        <span>AT ${ats.length}</span>
        <span>带手机号 ${phoneAts.length}</span>
        <span>可接入 ${enabledCount}</span>
      </div>
      ${ats.slice(0, 20).map(oaAtRow).join("")}
      ${ats.length > 20 ? `<div class="muted small-text">仅显示前 20 个 AT</div>` : ""}
    `
    : `<div class="empty">暂无 AT，先在 AT 池导入</div>`;
  bindOaAtActions();
}

function bindOaAtActions() {
  document.querySelectorAll("[data-at-oa]").forEach((select) => {
    if (select.dataset.boundAtOa === "1") return;
    select.dataset.boundAtOa = "1";
    select.addEventListener("change", async () => {
      try {
        await api(`/api/ats/${select.dataset.atOa}`, {
          method: "PATCH",
          body: JSON.stringify({enabled: select.value}),
        });
        toast("AT 的 OA 接入标识已保存");
        await loadAts();
      } catch (error) {
        toast(error.message);
      }
    });
  });
}

async function loadAts() {
  const data = await api("/api/ats");
  ats = data.items || [];
  const phoneAts = ats.filter((item) => item.phone && item.oa?.eligible);
  $("#phone-at-count").textContent = phoneAts.length;
  renderOaAts();
}

function taskRow(task) {
  const phone = task.phone ? `<span class="mono">${escapeHtml(task.phone)}</span>` : '<span class="muted">-</span>';
  const email = task.bindEmail ? `<span class="mono">${escapeHtml(task.bindEmail)}</span>` : '<span class="muted">-</span>';
  const sub2api = task.sub2apiAccount
    ? `<span class="mono token-pill">${escapeHtml(task.sub2apiAccount)}</span>`
    : `<span class="muted">${escapeHtml(task.sub2apiGroup || "-")}</span>`;
  const cancel = ["queued", "running"].includes(task.status)
    ? `<button class="danger small" type="button" data-cancel="${task.id}">取消</button>`
    : "";
  const del = ["failed", "canceled"].includes(task.status)
    ? `<button class="ghost small" type="button" data-delete="${task.id}">删除</button>`
    : "";
  const note = task.error
    ? `<div class="task-note error-text">${escapeHtml(task.error)}</div>`
    : `<div class="task-note">更新 ${fmtTime(task.updatedAt)}</div>`;
  return `
    <tr class="selectable ${task.id === selectedTaskId ? "selected" : ""}" data-id="${task.id}">
      <td>${badge(task.status)}</td>
      <td>
        <div class="task-main mono">${escapeHtml(taskName(task))}</div>
        ${note}
      </td>
      <td>${phone}</td>
      <td>${email}</td>
      <td>${sub2api}</td>
      <td><div class="row actions"><button class="small" type="button" data-open="${task.id}">日志</button>${cancel}${del}</div></td>
    </tr>
  `;
}

function renderTasks() {
  $("#tasks").innerHTML = tasks.length
    ? tasks.map(taskRow).join("")
    : `<tr><td colspan="6"><div class="empty">暂无 OA 接入任务。</div></td></tr>`;
  bindTaskActions();
}

async function loadTasks() {
  const data = await api("/api/oa/tasks");
  tasks = data.tasks || [];
  renderTasks();

  if (!$("#task-modal").classList.contains("hidden") && selectedTaskId) {
    const task = tasks.find((item) => item.id === selectedTaskId);
    if (task) renderTaskDetail(task);
  }
}

function renderTaskDetail(task) {
  if (!task) return;
  selectedTaskId = task.id;
  $("#task-modal-title").textContent = `任务日志 · ${taskName(task)}`;
  $("#task-modal-subtitle").textContent = `${task.status} / ${fmtTime(task.updatedAt)}`;
  $("#task-detail").textContent = (task.logs || []).join("\n") || "暂无日志";
  $("#task-modal").classList.remove("hidden");
  $("#task-detail").scrollTop = $("#task-detail").scrollHeight;
}

function closeTaskModal() {
  $("#task-modal").classList.add("hidden");
  selectedTaskId = "";
}

function bindTaskActions() {
  document.querySelectorAll("tr[data-id]").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      const task = tasks.find((item) => item.id === row.dataset.id);
      renderTaskDetail(task);
      renderTasks();
    });
  });

  document.querySelectorAll("[data-open]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const task = tasks.find((item) => item.id === btn.dataset.open);
      renderTaskDetail(task);
      renderTasks();
    });
  });

  document.querySelectorAll("[data-cancel]").forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      event.stopPropagation();
      await api(`/api/tasks/${btn.dataset.cancel}/cancel`, {method: "POST", body: "{}"});
      toast("已请求取消任务");
      await loadTasks();
    });
  });

  document.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      event.stopPropagation();
      await api(`/api/tasks/${btn.dataset.delete}`, {method: "DELETE"});
      if (selectedTaskId === btn.dataset.delete) closeTaskModal();
      toast("任务已删除");
      await loadTasks();
    });
  });
}

function openImportModal() {
  $("#import-modal").classList.remove("hidden");
  $("#import-text").focus();
}

function closeImportModal() {
  $("#import-modal").classList.add("hidden");
}

function sub2apiGroupText(sub2api) {
  const groups = Array.isArray(sub2api?.groupNames) && sub2api.groupNames.length
    ? sub2api.groupNames
    : [sub2api?.groupName || "codex"];
  return groups.filter(Boolean).join(",");
}

function renderSub2ApiConfig(data) {
  const sub2api = data.sub2api || {};
  const mailApi = data.mailApi || {};
  const register = data.register || {};
  $("#sub2api-config").textContent = JSON.stringify(sub2api, null, 2);
  if (!$("#sub2api-form")) return;
  $("#sub2apiUrl").value = sub2api.url || "";
  $("#sub2apiEmail").value = sub2api.email || "";
  $("#sub2apiPassword").value = "";
  $("#sub2apiPassword").placeholder = sub2api.passwordPresent ? "已配置，留空不修改" : "必填";
  $("#sub2apiGroupNames").value = sub2apiGroupText(sub2api);
  $("#sub2apiProxyName").value = sub2api.proxyName || "";
  $("#sub2apiAccountPriority").value = sub2api.accountPriority || 1;
  $("#sub2apiConcurrency").value = sub2api.concurrency || 10;
  if ($("#mail-api-base-url")) {
    $("#mail-api-base-url").value = mailApi.baseUrl || "";
  }
  if ($("#oa-proxy-current")) {
    $("#oa-proxy-current").textContent = `当前默认代理：${register.oaProxyUrl || register.defaultProxyUrl || "直连"}`;
  }
}

async function loadConfig() {
  configCache = await api("/api/config");
  renderSub2ApiConfig(configCache);
}

async function saveSub2ApiConfig(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const body = Object.fromEntries(form.entries());
  body.accountPriority = Number(body.accountPriority || 1);
  body.concurrency = Number(body.concurrency || 10);
  const data = await api("/api/config/sub2api", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  configCache = data;
  renderSub2ApiConfig(data);
  toast("SUB2API 配置已保存");
}

async function probeOaProxy() {
  const btn = $("#probe-oa-proxy");
  const output = $("#oa-probe-result");
  const proxyUrl = ($("#oaProxyUrl")?.value || "").trim();
  btn.disabled = true;
  output.classList.remove("hidden");
  output.textContent = "正在测试 auth.openai.com 网络...";
  try {
    const query = proxyUrl.toLowerCase() === "direct"
      ? "?target=oauth&direct=1"
      : (proxyUrl ? `?target=oauth&proxyUrl=${encodeURIComponent(proxyUrl)}` : "?target=oauth");
    const result = await api(`/api/oa/probe${query}`);
    output.textContent = JSON.stringify(result, null, 2);
    toast(result.ok ? `OAuth 网络可访问，耗时 ${result.elapsedMs}ms` : `OAuth 网络不可用：${result.error || "unknown"}`);
  } finally {
    btn.disabled = false;
  }
}

async function probeOaDirect() {
  const output = $("#oa-probe-result");
  output.classList.remove("hidden");
  output.textContent = "正在直连测试 auth.openai.com 网络...";
  const result = await api("/api/oa/probe?target=oauth&direct=1");
  output.textContent = JSON.stringify(result, null, 2);
  toast(result.ok ? `直连可访问，耗时 ${result.elapsedMs}ms` : `直连不可用：${result.error || "unknown"}`);
}

function buildOaProbeQuery(proxyUrl) {
  const value = String(proxyUrl || "").trim();
  if (value.toLowerCase() === "direct") return "?target=oauth&direct=1";
  return value
    ? `?target=oauth&proxyUrl=${encodeURIComponent(value)}`
    : "?target=oauth";
}

async function assertOaNetworkReady(proxyUrl) {
  const output = $("#oa-probe-result");
  output.classList.remove("hidden");
  output.textContent = "创建任务前正在检测 auth.openai.com 网络...";
  const result = await api(`/api/oa/probe${buildOaProbeQuery(proxyUrl)}`);
  output.textContent = JSON.stringify(result, null, 2);
  if (!result.ok) {
    const reason = result.timedOut
      ? `当前代理连接 OAuth 超时（${result.elapsedMs}ms）`
      : (result.status === 403 || result.blocked ? "OAuth 返回 403，当前网络/代理被拒绝" : (result.error || `HTTP ${result.status || "unknown"}`));
    throw new Error(`${reason}，已阻止创建任务，请更换 OA 登录代理后再试`);
  }
  return result;
}

async function saveOaProxy() {
  const proxyUrl = ($("#oaProxyUrl")?.value || "").trim();
  const data = await api("/api/config/oa-proxy", {
    method: "PATCH",
    body: JSON.stringify({proxyUrl}),
  });
  configCache = data;
  renderSub2ApiConfig(data);
  toast(proxyUrl ? "OA 默认代理已保存" : "OA 默认代理已清空，将直连");
}

$("#open-import").addEventListener("click", openImportModal);
$("#open-email-pool").addEventListener("click", openEmailListModal);
$("#email-pool-stat").addEventListener("click", openEmailListModal);
$("#email-pool-stat").addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    openEmailListModal();
  }
});
$("#reload-emails").addEventListener("click", () => loadEmails().catch((error) => toast(error.message)));
$("#reload-ats").addEventListener("click", () => loadAts().catch((error) => toast(error.message)));
$("#refresh-tasks").addEventListener("click", () => loadTasks().catch((error) => toast(error.message)));
$("#probe-oa-proxy").addEventListener("click", () => probeOaProxy().catch((error) => toast(error.message)));
$("#probe-oa-direct").addEventListener("click", () => probeOaDirect().catch((error) => toast(error.message)));
$("#save-oa-proxy").addEventListener("click", () => saveOaProxy().catch((error) => toast(error.message)));

document.querySelectorAll("[data-close-import]").forEach((el) => el.addEventListener("click", closeImportModal));
document.querySelectorAll("[data-close-task]").forEach((el) => el.addEventListener("click", closeTaskModal));
document.querySelectorAll("[data-close-email]").forEach((el) => el.addEventListener("click", closeEmailModal));
document.querySelectorAll("[data-close-email-list]").forEach((el) => el.addEventListener("click", closeEmailListModal));

$("#import-btn").addEventListener("click", async () => {
  const text = $("#import-text").value;
  const filePath = $("#import-file-path")?.value || "";
  const mailApiBaseUrl = $("#mail-api-base-url")?.value || "";
  try {
    const result = await api("/api/oa/emails/import", {
      method: "POST",
      body: JSON.stringify({text, filePath, mailApiBaseUrl}),
    });
    const invalid = Number(result.invalid || 0);
    const updated = Number(result.updated || 0);
    const needsBase = result.needsMailApiBaseUrl ? "；四段邮箱未组装，请填写接码 API 域名后点“按域名修复现有邮箱池”" : "";
    const message = invalid
      ? `导入完成：新增 ${result.added}，更新 ${updated}，跳过 ${result.skipped}，无效 ${invalid}${needsBase}。${(result.invalidSamples || [])[0] || ""}`
      : `导入完成：新增 ${result.added}，更新 ${updated}，跳过 ${result.skipped}${needsBase}`;
    toast(message);
    if (result.added > 0 || updated > 0 || result.skipped > 0) {
      if ($("#import-file-path")) $("#import-file-path").value = "";
      $("#import-text").value = "";
      closeImportModal();
    }
    await Promise.all([loadEmails(), loadConfig()]);
  } catch (error) {
    toast(error.message);
  }
});

$("#rebase-btn").addEventListener("click", async () => {
  const mailApiBaseUrl = $("#mail-api-base-url")?.value || "";
  try {
    const result = await api("/api/oa/emails/rebase", {
      method: "POST",
      body: JSON.stringify({mailApiBaseUrl}),
    });
    toast(`修复完成：更新 ${result.updated}，跳过 ${result.skipped}，无效 ${result.invalid}`);
    await Promise.all([loadEmails(), loadConfig()]);
  } catch (error) {
    toast(error.message);
  }
});

$("#task-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const body = Object.fromEntries(form.entries());
  body.count = Number(body.count || 1);
  body.concurrency = Number(body.concurrency || 1);
  body.removeTokenOnSuccess = $("#removeTokenOnSuccess").checked;
  try {
    await assertOaNetworkReady(body.oaProxyUrl || "");
  } catch (error) {
    toast(error.message);
    return;
  }
  const result = await api("/api/oa/tasks", {
    method: "POST",
    body: JSON.stringify(body),
  });
  toast(`已创建 ${result.tasks?.length || 0} 个 OA 接入任务`);
  await Promise.all([loadEmails(), loadAts(), loadTasks()]);
});

if ($("#sub2api-form")) {
  $("#sub2api-form").addEventListener("submit", (event) => saveSub2ApiConfig(event).catch((error) => toast(error.message)));
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  closeImportModal();
  closeTaskModal();
  closeEmailModal();
  closeEmailListModal();
});

async function init() {
  await Promise.all([loadEmails(), loadAts(), loadTasks(), loadConfig()]);
}

init().catch((error) => toast(error.message));
setInterval(() => loadTasks().catch(() => undefined), 3000);
setInterval(() => loadAts().catch(() => undefined), 10000);
