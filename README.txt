SESSION + INBOX SYNC FIX
========================

This version fixes the issue where a provider accepted the login, but the page
then showed “Add a mail account to begin.”

Changes:
- Trusts Render's HTTPS reverse proxy.
- Enables proxy-aware secure session cookies.
- Forces the session to save before the login request finishes.
- Saves Google sessions before redirecting back to the mailbox.
- Validates IMAP inbox access before adding Yahoo/iCloud/Rambler/Outlook.
- Loads the selected provider inbox immediately after successful login.
- Allows a valid inbox connection even if SMTP verification is blocked.

IMPORTANT:
- iCloud and Yahoo usually require an app-specific password.
- Render's default in-memory session storage resets when the server restarts.
  For permanent logins, add Redis or a database-backed session store.

TESTS PERFORMED:
- server.js syntax check: passed
- public/app.js syntax check: passed
- Verified Render proxy trust and session-save code paths are present
- Real provider authentication was not tested because no account credentials
  were available.

SYNC + LOGIN VALIDATION UPDATE
- After a successful connection, the app immediately opens that provider section and loads inbox messages.
- Yahoo, iCloud, Rambler, Outlook, and custom accounts are saved only after both IMAP inbox access and SMTP sending access are verified.
- Invalid credentials are rejected instead of creating a fake connected account.
- Gmail still uses Google OAuth because Google does not allow third-party password login.

CRASH FIX
- Prevents Cannot read properties of undefined (reading length).
- Handles missing accounts, messages, and provider values safely.

LOGIN FIX EDITION
=================

FIRST: DEPLOY THIS AS A RENDER WEB SERVICE, NOT A STATIC SITE.

Render settings:
- Runtime: Node
- Root directory: leave blank
- Build command: npm install
- Start command: npm start
- Publish directory: leave blank

After deployment, visit:
  https://YOUR-SERVICE.onrender.com/api/health

You should see JSON containing:
  "ok": true

If /api/health says Not Found, the project is still deployed as a Static Site
or Render is running from the wrong folder.

GOOGLE LOGIN
1. Create a Google Cloud Web application OAuth client.
2. Enable the Gmail API.
3. Add this exact Authorized redirect URI:
   https://YOUR-SERVICE.onrender.com/auth/google/callback
4. Set these Render environment variables:
   BASE_URL=https://YOUR-SERVICE.onrender.com
   GOOGLE_CLIENT_ID=your-client-id
   GOOGLE_CLIENT_SECRET=your-client-secret
   GOOGLE_REDIRECT_URI=https://YOUR-SERVICE.onrender.com/auth/google/callback
5. Redeploy after saving the variables.

The URL must match exactly, including https, hostname, and /auth/google/callback.

OTHER PROVIDERS
- Yahoo and iCloud normally require an app-specific password.
- Do not enter the normal account password.
- Rambler or Outlook may block basic IMAP login depending on the account.
- For public multi-user use, each provider should eventually use OAuth.

SECURITY
This is a development starter. Do not publish it for other people until you
replace the in-memory session store and encrypt saved provider credentials.

UPDATED VERSION
- Supports multiple connected accounts.
- Adds All Mail, Google, iCloud, Yahoo, Rambler, Outlook, and Other Mail sections.
- Gmail uses secure Google OAuth; it does not accept a normal Google password.

MYMAIL FULL PROJECT
===================

WHAT THIS PROJECT DOES
- Modern animated webmail interface
- Secure Gmail connection through Google OAuth 2.0
- Yahoo, iCloud, Outlook, Rambler, and custom servers through IMAP/SMTP
- Loads inbox messages
- Opens message text
- Sends messages
- Includes Render deployment configuration

IMPORTANT LIMITS
1. A website cannot create a real @mymail.com mailbox by itself.
2. You must own the domain and connect it to a mail-hosting service.
3. Yahoo, iCloud, Outlook, Rambler, and many other providers require an
   app-specific password. Do not enter your normal account password.
4. This starter stores an IMAP app password in the server session so it can
   sync mail. The default in-memory session store is for personal testing only.
   Before opening this to other users, use a database-backed encrypted account
   store and a production session store.
5. Some Microsoft accounts disable basic IMAP/SMTP password authentication.
   Those accounts need Microsoft OAuth, which is not included in this starter.

LOCAL SETUP
1. Install Node.js 20 or newer.
2. Extract the ZIP.
3. Open a terminal in the project folder.
4. Run:
      npm install
5. Rename .env.example to .env.
6. Set SESSION_SECRET to a long random value.
7. Run:
      npm start
8. Open:
      http://localhost:3000

GMAIL SETUP
1. Open Google Cloud Console.
2. Create a project.
3. Enable the Gmail API.
4. Configure the OAuth consent screen.
5. Create an OAuth 2.0 Client ID of type "Web application".
6. Add this authorized redirect URI for local testing:
      http://localhost:3000/auth/google/callback
7. Copy the Client ID and Client Secret into .env.
8. Keep your test account listed as an OAuth test user while the app is in
   testing mode.

RENDER SETUP
1. Upload this project to GitHub.
2. Create a Render Web Service from the repository, or use render.yaml.
3. Add environment variables:
      BASE_URL=https://YOUR-SERVICE.onrender.com
      GOOGLE_CLIENT_ID=...
      GOOGLE_CLIENT_SECRET=...
      GOOGLE_REDIRECT_URI=https://YOUR-SERVICE.onrender.com/auth/google/callback
      SESSION_SECRET=...
4. Add the same Render callback URL to the Google OAuth client's authorized
   redirect URIs.
5. Build command:
      npm install
6. Start command:
      npm start
7. Do not set a publish/build directory. This is a Node web service.

CUSTOM @MYMAIL.COM ADDRESSES
To make real addresses such as name@mymail.com:
- Own the domain.
- Buy or configure mail hosting.
- Add MX, SPF, DKIM, and DMARC DNS records.
- Use the Custom IMAP / SMTP option in this app with the server information
  from your mail host.
- Change CUSTOM_DOMAIN in .env to your actual domain.

SECURITY BEFORE PUBLIC USE
- Use HTTPS.
- Replace express-session's MemoryStore with Redis or another persistent store.
- Encrypt provider tokens and app passwords at rest.
- Add CSRF protection, rate limits, account isolation, input validation, and
  audit logging.
- Have a privacy policy and follow each provider's OAuth requirements.
