const state = {
  accounts: [],
  workflows: [],
  filter: '',
};

const $ = (selector) => document.querySelector(selector);

function toast(message, type = 'info') {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.className = `toast show ${type}`;
  setTimeout(() => el.className = 'toast', 2600);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: {'Content-Type': 'application/json', ...(options.headers || {})},
    ...options,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function fmt(value) {
  return value == null || value === '' ? '-' : String(value);
}

function shortHash(value) {
  if (!value) return '-';
  const text = String(value);
  return text.length > 18 ? `${text.slice(0, 10)}...${text.slice(-6)}` : text;
}

function fmtTime(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function statusBadge(status) {
  const value = status || 'unknown';
  const ok = ['free', 'at_ready', 'plus_success', 'email_bound', 'oa_success', 'success'].includes(value);
  const bad = ['failed', 'plus_failed', 'oa_failed'].includes(value);
  const wait = ['registered', 'plus_pending', 'oa_pending', 'queued', 'running', 'awaiting_plus_otp'].includes(value);
  const cls = bad ? 'bad' : ok ? 'ok' : wait ? 'wait' : '';
  return `<span class="badge ${cls}">${value}</span>`;
}

function renderSummary(summary = {}) {
  const free = summary.statuses?.free || 0;
  $('#account-summary').innerHTML = `
    <div class="stat"><div class="label">账号</div><div class="value">${summary.total || 0}</div></div>
    <div class="stat"><div class="label">Free 完成</div><div class="value">${free}</div></div>
    <div class="stat"><div class="label">带手机号</div><div class="value">${summary.withPhone || 0}</div></div>
    <div class="stat"><div class="label">有 AT</div><div class="value">${summary.withAccessToken || 0}</div></div>
    <div class="stat"><div class="label">Plus 成功</div><div class="value">${summary.plusSuccess || 0}</div></div>
    <div class="stat"><div class="label">OA 成功</div><div class="value">${summary.oaSuccess || 0}</div></div>
  `;
}

function accountSearchText(account) {
  return [
    account.id,
    account.status,
    account.phone,
    account.accessToken?.hash,
    account.accessToken?.preview,
    account.emailBinding?.email,
    account.oa?.account,
    account.oa?.sub2apiAccount,
    account.oa?.cpaAccount,
    account.plus?.localId,
    account.plus?.remoteJobId,
  ].filter(Boolean).join(' ').toLowerCase();
}

function filteredAccounts() {
  const filter = state.filter.trim().toLowerCase();
  if (!filter) return state.accounts;
  return state.accounts.filter((account) => accountSearchText(account).includes(filter));
}

function renderAccounts() {
  const rows = filteredAccounts();
  $('#accounts').innerHTML = rows.length ? rows.map((account) => {
    const at = account.accessToken;
    const plus = account.plus;
    const email = account.emailBinding;
    const oa = account.oa;
    return `
      <tr class="clickable-row" data-id="${account.id}">
        <td>${statusBadge(account.status)}<div class="muted mono tiny">${account.id}</div></td>
        <td class="mono">${fmt(account.phone)}</td>
        <td>
          <div class="mono">${shortHash(at?.hash)}</div>
          <div class="muted tiny">${at?.active === false ? '已移除' : at?.expired ? '已过期' : 'active'}</div>
        </td>
        <td>
          <div>${plus ? statusBadge(plus.status) : '-'}</div>
          <div class="muted tiny">${plus?.resultCode || plus?.billingStatus || plus?.localId || ''}</div>
        </td>
        <td>
          <div>${fmt(email?.email)}</div>
          <div class="muted tiny">${email?.status || ''}</div>
        </td>
        <td>
          <div>${oa ? statusBadge(oa.status) : '-'}</div>
          <div class="muted tiny">${oa?.target || ''} ${oa?.account || oa?.sub2apiAccount || oa?.cpaAccount || ''}</div>
        </td>
        <td>${fmtTime(account.updatedAt)}</td>
      </tr>
    `;
  }).join('') : `<tr><td colspan="7" class="empty-cell">暂无账户台账。点击“历史补账”生成。</td></tr>`;

  document.querySelectorAll('[data-id]').forEach((row) => {
    row.addEventListener('click', () => openAccount(row.dataset.id));
  });
}

function renderWorkflows() {
  $('#workflows').innerHTML = state.workflows.length ? state.workflows.map((wf) => `
    <div class="workflow-item">
      <div class="workflow-top">
        ${statusBadge(wf.status)}
        <span class="mono tiny">${wf.runId}</span>
      </div>
      <div class="muted tiny">step=${wf.step} target=${wf.target} phone=${wf.phone || '-'}</div>
      <div class="muted tiny">AT=${shortHash(wf.tokenHash)} email=${wf.bindEmail || '-'}</div>
      ${wf.error ? `<div class="error-text tiny">${wf.error}</div>` : ''}
    </div>
  `).join('') : '<div class="muted">暂无 workflow。</div>';
}

async function loadAccounts() {
  const data = await api('/api/accounts');
  state.accounts = data.accounts || [];
  renderSummary(data.summary || {});
  renderAccounts();
}

async function loadWorkflows() {
  const data = await api('/api/workflows');
  state.workflows = data.workflows || [];
  renderWorkflows();
}

async function refreshAll() {
  await Promise.all([loadAccounts(), loadWorkflows()]);
}

async function openAccount(id) {
  const data = await api(`/api/accounts/${encodeURIComponent(id)}`);
  $('#account-detail').textContent = JSON.stringify(data.account, null, 2);
  $('#account-modal').classList.remove('hidden');
}

function closeModal() {
  $('#account-modal').classList.add('hidden');
}

async function reconcile() {
  const button = $('#reconcile');
  button.disabled = true;
  button.textContent = '补账中...';
  try {
    const result = await api('/api/reconcile', {method: 'POST', body: '{}'});
    toast(`补账完成：账号 ${result.summary?.total || 0} 个`, 'ok');
    await refreshAll();
  } catch (error) {
    toast(error.message, 'bad');
  } finally {
    button.disabled = false;
    button.textContent = '历史补账';
  }
}

async function createWorkflow(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const plus = $('#plus').checked;
  const body = {
    target: form.target.value,
    plus,
    paypalPhone: form.paypalPhone.value.trim(),
    concurrency: Number(form.concurrency.value || 1),
    removeTokenOnSuccess: form.removeTokenOnSuccess.value === 'true',
  };
  if (plus && !body.paypalPhone) {
    toast('包含 Plus 升级时必须填写 PayPal 手机', 'bad');
    return;
  }
  try {
    const data = await api('/api/workflows/phone-plus-oa', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    toast(`已启动 ${data.workflow.runId}`, 'ok');
    await loadWorkflows();
  } catch (error) {
    toast(error.message, 'bad');
  }
}

function bindEvents() {
  $('#refresh').addEventListener('click', () => refreshAll().catch((error) => toast(error.message, 'bad')));
  $('#refresh-workflows').addEventListener('click', () => loadWorkflows().catch((error) => toast(error.message, 'bad')));
  $('#reconcile').addEventListener('click', reconcile);
  $('#workflow-form').addEventListener('submit', createWorkflow);
  $('#close-modal').addEventListener('click', closeModal);
  $('#account-modal').addEventListener('click', (event) => {
    if (event.target.id === 'account-modal') closeModal();
  });
  $('#account-filter').addEventListener('input', (event) => {
    state.filter = event.target.value;
    renderAccounts();
  });
}

bindEvents();
refreshAll().catch((error) => toast(error.message, 'bad'));
setInterval(() => refreshAll().catch(() => undefined), 10000);
