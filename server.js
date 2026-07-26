require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const nodemailer = require("nodemailer");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const { google } = require("googleapis");
const path = require("path");

const app = express();
// Render and similar hosts terminate HTTPS at a reverse proxy.
// Trusting one proxy hop allows secure session cookies to be saved correctly.
app.set("trust proxy", 1);
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI || `${BASE_URL}/auth/google/callback`;

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use(
  session({
    name: "mymail.sid",
    secret: process.env.SESSION_SECRET || "development-only-change-me",
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);
app.use(express.static(path.join(__dirname, "public")));

const PROVIDERS = {
  yahoo: {
    label: "Yahoo",
    imap: { host: "imap.mail.yahoo.com", port: 993, secure: true },
    smtp: { host: "smtp.mail.yahoo.com", port: 465, secure: true }
  },
  icloud: {
    label: "iCloud",
    imap: { host: "imap.mail.me.com", port: 993, secure: true },
    smtp: { host: "smtp.mail.me.com", port: 587, secure: false }
  },
  outlook: {
    label: "Outlook",
    imap: { host: "outlook.office365.com", port: 993, secure: true },
    smtp: { host: "smtp.office365.com", port: 587, secure: false }
  },
  rambler: {
    label: "Rambler",
    imap: { host: "imap.rambler.ru", port: 993, secure: true },
    smtp: { host: "smtp.rambler.ru", port: 465, secure: true }
  }
};

function validEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

async function verifyMailbox(settings, email, password) {
  const imap = new ImapFlow({
    host: settings.imap.host,
    port: settings.imap.port,
    secure: settings.imap.secure,
    auth: { user: email, pass: password },
    logger: false,
    socketTimeout: 20000,
    greetingTimeout: 15000
  });

  try {
    await imap.connect();
    await imap.mailboxOpen("INBOX");
  } finally {
    if (imap.usable) await imap.logout().catch(() => {});
  }

  const smtp = nodemailer.createTransport({
    host: settings.smtp.host,
    port: settings.smtp.port,
    secure: settings.smtp.secure,
    auth: { user: email, pass: password },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
    tls: { servername: settings.smtp.host }
  });
  let smtpVerified = true;
  let smtpWarning = "";
  try {
    await smtp.verify();
  } catch (error) {
    // A valid inbox login should still be usable even when a provider blocks
    // SMTP verification. Sending will show a separate error if attempted.
    smtpVerified = false;
    smtpWarning = error?.response || error?.message || "SMTP verification failed.";
  }
  return { smtpVerified, smtpWarning };
}

function accounts(req) {
  if (!Array.isArray(req.session.accounts)) req.session.accounts = [];
  return req.session.accounts;
}

function publicAccount(account) {
  return {
    id: account.id,
    type: account.type,
    provider: account.provider,
    email: account.email,
    label: account.label || account.provider
  };
}

function findAccount(req, id) {
  return accounts(req).find((item) => item.id === id);
}

function googleOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
}

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value = "") {
  value = value.replace(/-/g, "+").replace(/_/g, "/");
  while (value.length % 4) value += "=";
  return Buffer.from(value, "base64").toString("utf8");
}

function gmailHeader(headers = [], name) {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
}

function findTextPart(payload) {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  for (const part of payload.parts || []) {
    const text = findTextPart(part);
    if (text) return text;
  }
  return payload.body?.data ? decodeBase64Url(payload.body.data) : "";
}

async function listGmail(account, limit) {
  const client = googleOAuthClient();
  client.setCredentials(account.tokens);
  const gmail = google.gmail({ version: "v1", auth: client });
  const list = await gmail.users.messages.list({
    userId: "me", maxResults: limit, labelIds: ["INBOX"]
  });

  return Promise.all((list.data.messages || []).map(async ({ id }) => {
    const message = await gmail.users.messages.get({
      userId: "me", id, format: "metadata",
      metadataHeaders: ["From", "Subject", "Date"]
    });
    const headers = message.data.payload?.headers || [];
    return {
      id, accountId: account.id, provider: "gmail",
      accountEmail: account.email,
      from: gmailHeader(headers, "From"),
      subject: gmailHeader(headers, "Subject") || "(No subject)",
      date: gmailHeader(headers, "Date"),
      snippet: message.data.snippet || ""
    };
  }));
}

async function listImap(account, limit) {
  const client = new ImapFlow({
    host: account.settings.imap.host,
    port: account.settings.imap.port,
    secure: account.settings.imap.secure,
    auth: { user: account.email, pass: account.password },
    logger: false
  });

  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    const count = client.mailbox.exists || 0;
    if (!count) return [];
    const start = Math.max(1, count - limit + 1);
    const fetched = await client.fetchAll(`${start}:*`, {
      uid: true, envelope: true, flags: true
    });
    return fetched.reverse().map((message) => ({
      id: String(message.uid),
      accountId: account.id,
      provider: account.provider,
      accountEmail: account.email,
      from: message.envelope?.from?.map((x) => x.name || x.address).join(", ") || "Unknown sender",
      subject: message.envelope?.subject || "(No subject)",
      date: message.envelope?.date || "",
      snippet: ""
    }));
  } finally {
    lock.release();
    await client.logout();
  }
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "MyMail",
    googleConfigured: Boolean(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ),
    baseUrl: BASE_URL,
    googleRedirectUri: GOOGLE_REDIRECT_URI
  });
});

app.get("/api/config", (req, res) => {
  res.json({
    customDomain: process.env.CUSTOM_DOMAIN || "mymail.com",
    gmailConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    providers: [
      { id: "gmail", label: "Gmail", auth: "oauth" },
      ...Object.entries(PROVIDERS).map(([id, value]) => ({
        id, label: value.label, auth: "app-password"
      })),
      { id: "custom", label: "Other mail", auth: "app-password" }
    ]
  });
});

app.get("/api/session", (req, res) => {
  res.json({ accounts: accounts(req).map(publicAccount) });
});

app.get("/auth/google", (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.redirect("/?error=" + encodeURIComponent("Google OAuth is not configured in .env."));
  }
  const client = googleOAuthClient();
  res.redirect(client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/userinfo.email"
    ]
  }));
});

app.get("/auth/google/callback", async (req, res) => {
  try {
    if (!req.query.code) throw new Error("Missing Google authorization code.");
    const client = googleOAuthClient();
    const { tokens } = await client.getToken(String(req.query.code));
    client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const profile = await oauth2.userinfo.get();
    const list = accounts(req);
    const existing = list.find((item) => item.provider === "gmail" && item.email === profile.data.email);
    if (existing) existing.tokens = tokens;
    else list.push({
      id: crypto.randomUUID(),
      type: "gmail",
      provider: "gmail",
      label: "Gmail",
      email: profile.data.email,
      tokens
    });
    req.session.save((saveError) => {
      if (saveError) {
        console.error(saveError);
        return res.redirect("/?error=" + encodeURIComponent("Google connected, but the session could not be saved."));
      }
      res.redirect("/?connected=gmail");
    });
  } catch (error) {
    console.error(error);
    res.redirect("/?error=" + encodeURIComponent(error.message));
  }
});

app.post("/api/connect/imap", async (req, res) => {
  const { provider, email, password, custom } = req.body || {};
  if (!validEmail(email) || typeof password !== "string" || !password.trim()) {
    return res.status(400).json({ error: "Enter a valid email address and app-specific password." });
  }
  if (provider === "gmail") {
    return res.status(400).json({
      error: "Gmail must use Continue with Google. Regular Google passwords are not accepted."
    });
  }

  let settings;
  let label;
  if (provider === "custom") {
    const imapPort = Number(custom?.imapPort);
    const smtpPort = Number(custom?.smtpPort);
    if (!custom?.imapHost || !custom?.smtpHost || !imapPort || !smtpPort) {
      return res.status(400).json({ error: "Custom IMAP and SMTP settings are incomplete." });
    }
    label = "Other mail";
    settings = {
      imap: { host: custom.imapHost, port: imapPort, secure: Boolean(custom.imapSecure) },
      smtp: { host: custom.smtpHost, port: smtpPort, secure: Boolean(custom.smtpSecure) }
    };
  } else {
    const preset = PROVIDERS[provider];
    if (!preset) return res.status(400).json({ error: "Unsupported provider." });
    label = preset.label;
    settings = preset;
  }

  try {
    // The account is added only after the provider accepts IMAP inbox access.
    const verification = await verifyMailbox(settings, email.trim(), password);
    const list = accounts(req);
    const existing = list.find((item) => item.provider === provider && item.email === email);
    if (existing) {
      existing.password = password;
      existing.settings = settings;
      existing.email = email.trim();
    } else {
      list.push({
        id: crypto.randomUUID(), type: "imap", provider, label, email: email.trim(), password, settings
      });
    }
    req.session.save((saveError) => {
      if (saveError) {
        console.error(saveError);
        return res.status(500).json({ error: "The account was verified, but the login session could not be saved." });
      }
      res.json({
        ok: true,
        accounts: list.map(publicAccount),
        smtpVerified: verification.smtpVerified,
        warning: verification.smtpVerified ? "" : "Inbox connected, but sending may require different SMTP settings or provider approval."
      });
    });
  } catch (error) {
    console.error(error);
    const code = error?.responseCode || error?.code || "AUTH_FAILED";
    res.status(401).json({
      error: `Login rejected by ${label || provider}. Check the email address, use an app-specific password, and confirm IMAP/SMTP access is enabled. (${code})`
    });
  }
});

app.delete("/api/accounts/:id", (req, res) => {
  req.session.accounts = accounts(req).filter((item) => item.id !== req.params.id);
  res.json({ ok: true, accounts: req.session.accounts.map(publicAccount) });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/messages", async (req, res) => {
  const provider = String(req.query.provider || "all");
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
  const selected = accounts(req).filter((account) =>
    provider === "all" ? true : account.provider === provider
  );
  if (!selected.length) return res.json({ messages: [] });

  const settled = await Promise.allSettled(
    selected.map((account) =>
      account.type === "gmail" ? listGmail(account, limit) : listImap(account, limit)
    )
  );

  const messages = settled.flatMap((result) =>
    result.status === "fulfilled" ? result.value : []
  ).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  const errors = settled.filter((result) => result.status === "rejected").length;
  res.json({ messages, partial: errors > 0 });
});

app.get("/api/messages/:accountId/:id", async (req, res) => {
  const account = findAccount(req, req.params.accountId);
  if (!account) return res.status(404).json({ error: "Connected account not found." });

  try {
    if (account.type === "gmail") {
      const client = googleOAuthClient();
      client.setCredentials(account.tokens);
      const gmail = google.gmail({ version: "v1", auth: client });
      const response = await gmail.users.messages.get({
        userId: "me", id: req.params.id, format: "full"
      });
      const headers = response.data.payload?.headers || [];
      return res.json({
        from: gmailHeader(headers, "From"),
        to: gmailHeader(headers, "To"),
        subject: gmailHeader(headers, "Subject") || "(No subject)",
        date: gmailHeader(headers, "Date"),
        body: findTextPart(response.data.payload) || response.data.snippet || ""
      });
    }

    const client = new ImapFlow({
      host: account.settings.imap.host,
      port: account.settings.imap.port,
      secure: account.settings.imap.secure,
      auth: { user: account.email, pass: account.password },
      logger: false
    });
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const result = await client.fetchOne(
        String(req.params.id),
        { source: true, envelope: true, uid: true },
        { uid: true }
      );
      if (!result?.source) return res.status(404).json({ error: "Message not found." });
      const parsed = await simpleParser(result.source);
      res.json({
        from: parsed.from?.text || "",
        to: parsed.to?.text || "",
        subject: parsed.subject || "(No subject)",
        date: parsed.date || "",
        body: parsed.text || "This message has no plain-text version."
      });
    } finally {
      lock.release();
      await client.logout();
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not open that message." });
  }
});

app.post("/api/send", async (req, res) => {
  const { accountId, to, subject, body } = req.body || {};
  const account = findAccount(req, accountId);
  if (!account) return res.status(400).json({ error: "Choose a connected sending account." });
  if (!to || !body) return res.status(400).json({ error: "Recipient and message are required." });

  try {
    if (account.type === "gmail") {
      const client = googleOAuthClient();
      client.setCredentials(account.tokens);
      const gmail = google.gmail({ version: "v1", auth: client });
      const raw = [
        `From: ${account.email}`, `To: ${to}`,
        `Subject: ${subject || "(No subject)"}`,
        "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "", body
      ].join("\r\n");
      await gmail.users.messages.send({
        userId: "me", requestBody: { raw: encodeBase64Url(raw) }
      });
    } else {
      const transporter = nodemailer.createTransport({
        host: account.settings.smtp.host,
        port: account.settings.smtp.port,
        secure: account.settings.smtp.secure,
        auth: { user: account.email, pass: account.password }
      });
      await transporter.sendMail({
        from: account.email, to, subject: subject || "(No subject)", text: body
      });
    }
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "The message could not be sent." });
  }
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/auth/")) return next();
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => console.log(`MyMail running at ${BASE_URL}`));
