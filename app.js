const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let accounts = [];
let messages = [];

function safeArray(value) { return Array.isArray(value) ? value : []; }
function safeProvider(value) { return typeof value === "string" && value.trim() ? value.trim() : "custom"; }
function providerInitial(value) { return safeProvider(value).charAt(0).toUpperCase() || "M"; }
let currentProvider = "all";

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}
function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[c]);
}
function formatDate(value) {
  const d = new Date(value);
  return !value || Number.isNaN(d.getTime()) ? "" : d.toLocaleString([], {
    month:"short",day:"numeric",hour:"numeric",minute:"2-digit"
  });
}
function status(el, msg, good=false) {
  el.textContent = msg; el.style.color = good ? "#86efac" : "#fda4af";
}
function providerName(id) {
  return ({all:"All Mail",gmail:"Google",icloud:"iCloud",yahoo:"Yahoo",
    rambler:"Rambler",outlook:"Outlook",custom:"Other mail"})[id] || id;
}
async function boot() {
  try {
    await request("/api/health");
  } catch (error) {
    throw new Error("The Node backend is not running. On Render, deploy this as a Web Service, not a Static Site.");
  }
  const params = new URLSearchParams(location.search);
  if (params.get("error")) {
    $("#accountDialog").showModal();
    status($("#connectStatus"), params.get("error"));
  }
  const [config, session] = await Promise.all([request("/api/config"), request("/api/session")]);
  accounts = safeArray(session.accounts);
  $("#gmailButton").disabled = !config.gmailConfigured;
  if (!config.gmailConfigured) $("#gmailButton small").textContent = "Add Google keys to .env";
  renderAccounts();
  await loadMessages();
}
function renderAccounts() {
  accounts = safeArray(accounts);
  $("#accountList").innerHTML = accounts.length ? accounts.map(a => {
    a = a || {};
    const provider = safeProvider(a.provider);
    return `
    <div class="connected-account">
      <span class="account-badge ${escapeHtml(provider)}">${escapeHtml(providerInitial(provider))}</span>
      <div><b>${escapeHtml(a.email)}</b><small>${escapeHtml(providerName(provider))}</small></div>
      <button data-remove="${escapeHtml(a.id)}" title="Remove">×</button>
    </div>`;
  }).join("") : '<p class="no-accounts">No accounts connected.</p>';
  $("#sendAccount").innerHTML = accounts.map(a => {
    a = a || {};
    const provider = safeProvider(a.provider);
    return `<option value="${escapeHtml(a.id)}">${escapeHtml(a.email || "Unknown account")} — ${escapeHtml(providerName(provider))}</option>`;
  }).join("");
  $$("[data-remove]").forEach(btn => btn.onclick = async () => {
    const result = await request(`/api/accounts/${encodeURIComponent(btn.dataset.remove)}`, {method:"DELETE"});
    accounts = safeArray(result.accounts); renderAccounts(); loadMessages();
  });
}
async function loadMessages() {
  $("#messageList").innerHTML = accounts.length
    ? '<div class="empty-state"><div class="loader"></div><p>Loading mail…</p></div>'
    : '<div class="empty-state"><p>Add a mail account to begin.</p></div>';
  if (!accounts.length) return;
  try {
    const data = await request(`/api/messages?provider=${encodeURIComponent(currentProvider)}&limit=30`);
    messages = safeArray(data.messages);
    renderMessages(messages);
    if (data.partial) {
      const note = document.createElement("div");
      note.className = "sync-warning";
      note.textContent = "Some connected accounts could not sync. Reconnect them with a valid app password.";
      $("#messageList").prepend(note);
    }
  } catch (e) {
    $("#messageList").innerHTML = `<div class="empty-state"><p>${escapeHtml(e.message)}</p></div>`;
  }
}
function renderMessages(items) {
  items = safeArray(items);
  if (!items.length) {
    $("#messageList").innerHTML = `<div class="empty-state"><p>No ${escapeHtml(providerName(currentProvider))} messages found.</p></div>`;
    return;
  }
  $("#messageList").innerHTML = items.map(m => {
    m = m || {};
    const provider = safeProvider(m.provider);
    return `
    <article class="message" data-account="${escapeHtml(m.accountId)}" data-id="${escapeHtml(m.id)}">
      <div class="message-top"><b>${escapeHtml(m.from || "Unknown sender")}</b><time>${escapeHtml(formatDate(m.date))}</time></div>
      <div class="message-provider"><span class="account-badge ${escapeHtml(provider)}">${escapeHtml(providerInitial(provider))}</span>${escapeHtml(m.accountEmail)}</div>
      <h3>${escapeHtml(m.subject || "(No subject)")}</h3>
      <p>${escapeHtml(m.snippet || "Open to read this message.")}</p>
    </article>`;
  }).join("");
  $$(".message").forEach(el => el.onclick = () => openMessage(el.dataset.account, el.dataset.id));
}
async function openMessage(accountId, id) {
  $("#readerEmpty").classList.add("hidden");
  $("#readerContent").classList.remove("hidden");
  $("#readSubject").textContent = "Loading…"; $("#readBody").textContent = "";
  $(".reader").classList.add("open");
  try {
    const m = await request(`/api/messages/${encodeURIComponent(accountId)}/${encodeURIComponent(id)}`);
    $("#readDate").textContent = formatDate(m.date);
    $("#readSubject").textContent = m.subject;
    $("#readFrom").textContent = `From: ${m.from}`;
    $("#readTo").textContent = m.to ? `To: ${m.to}` : "";
    $("#readBody").textContent = m.body;
  } catch (e) { $("#readSubject").textContent = "Could not open message"; $("#readBody").textContent = e.message; }
}
function switchProvider(provider) {
  currentProvider = provider;
  $("#viewTitle").textContent = providerName(provider);
  $$("[data-provider]").forEach(el => el.classList.toggle("active", el.dataset.provider === provider));
  loadMessages();
}
$$("[data-provider]").forEach(el => el.onclick = () => switchProvider(el.dataset.provider));
$("#provider").onchange = e => {
  const gmail = e.target.value === "gmail";
  $("#googleLoginBox").classList.toggle("hidden", !gmail);
  $("#passwordLoginBox").classList.toggle("hidden", gmail);
  $("#customFields").classList.toggle("hidden", e.target.value !== "custom");
};
$("#gmailButton").onclick = () => location.href = "/auth/google";
$("#addAccountButton").onclick = () => $("#accountDialog").showModal();
$("#closeAccount").onclick = () => $("#accountDialog").close();
$("#connectForm").onsubmit = async e => {
  e.preventDefault();
  const provider = $("#provider").value;
  if (provider === "gmail") return;
  status($("#connectStatus"), "Checking account…", true);
  try {
    const result = await request("/api/connect/imap", {
      method:"POST",
      body:JSON.stringify({
        provider,
        email:$("#connectEmail").value.trim(),
        password:$("#connectPassword").value,
        custom: provider === "custom" ? {
          imapHost:$("#imapHost").value.trim(), imapPort:Number($("#imapPort").value),
          imapSecure:$("#imapSecure").checked, smtpHost:$("#smtpHost").value.trim(),
          smtpPort:Number($("#smtpPort").value), smtpSecure:$("#smtpSecure").checked
        } : undefined
      })
    });
    accounts = safeArray(result.accounts);
    renderAccounts();
    if (result.warning) {
      status($("#connectStatus"), result.warning, true);
    }
    $("#accountDialog").close();
    currentProvider = provider;
    $("#viewTitle").textContent = providerName(provider);
    $$('[data-provider]').forEach(el => el.classList.toggle("active", el.dataset.provider === provider));
    await loadMessages();
  } catch (e) { status($("#connectStatus"), e.message); }
};
$("#searchInput").oninput = e => {
  const q = e.target.value.toLowerCase();
  renderMessages(safeArray(messages).filter(m => [m?.from,m?.subject,m?.snippet,m?.accountEmail].join(" ").toLowerCase().includes(q)));
};
$("#refreshButton").onclick = loadMessages;
$("#closeReader").onclick = () => $(".reader").classList.remove("open");
$("#floatingCompose").onclick = () => {
  if (!accounts.length) return $("#accountDialog").showModal();
  $("#composeDialog").showModal();
};
$("#closeCompose").onclick = () => $("#composeDialog").close();
$("#sendForm").onsubmit = async e => {
  e.preventDefault(); status($("#sendStatus"), "Sending…", true);
  try {
    await request("/api/send", {method:"POST",body:JSON.stringify({
      accountId:$("#sendAccount").value,to:$("#sendTo").value.trim(),
      subject:$("#sendSubject").value.trim(),body:$("#sendBody").value
    })});
    status($("#sendStatus"), "Message sent.", true);
    setTimeout(() => { $("#composeDialog").close(); $("#sendForm").reset(); $("#sendStatus").textContent=""; }, 700);
  } catch(e) { status($("#sendStatus"), e.message); }
};
$("#disconnectAll").onclick = async () => {
  await request("/api/logout", {method:"POST"}); accounts=[]; renderAccounts(); loadMessages();
};
boot().catch(e => { $("#messageList").innerHTML = `<div class="empty-state"><p>${escapeHtml(e.message)}</p></div>`; });
