IMPORTANT — FIXING RENDER "NOT FOUND"
=======================================

The Google route is included in server.js. If /auth/google says Not Found,
Render is not running this Node server. A Static Site cannot run OAuth routes.

USE A NEW RENDER WEB SERVICE:
1. In Render, click New + > Web Service.
2. Upload/push the contents of this ZIP with server.js and package.json at the repository root.
3. Runtime: Node
4. Root Directory: leave blank
5. Build Command: npm install
6. Start Command: npm start
7. Publish Directory: leave blank

DO NOT choose Static Site. Changing files inside an existing Static Site does
not turn it into a Web Service. Create a new Web Service or use render.yaml as
a Blueprint.

TEST IN THIS ORDER:
- https://YOUR-SERVICE.onrender.com/__backend
  Must say: MyMail Node backend is running
- https://YOUR-SERVICE.onrender.com/api/health
  Must return JSON with ok:true
- https://YOUR-SERVICE.onrender.com/auth/google
  Must redirect to Google

If the first URL says Not Found, stop: it is a Render service-type/root-folder
problem, not a Google OAuth problem.

MYMAIL GOOGLE OAUTH + QR/PASSKEY FIX
==================================

RENDER MUST BE A WEB SERVICE
- Runtime: Node
- Build command: npm install
- Start command: npm start
- Root directory: blank
- Publish directory: blank

After deployment open:
  https://YOUR-SERVICE.onrender.com/api/health
  https://YOUR-SERVICE.onrender.com/auth/status
  https://YOUR-SERVICE.onrender.com/auth/google

None of those should say Render Not Found.

GOOGLE CLOUD SETTINGS
Create a Web application OAuth client and add this exact Authorized redirect URI:
  https://YOUR-SERVICE.onrender.com/auth/google/callback

Render environment variables:
  BASE_URL=https://YOUR-SERVICE.onrender.com
  GOOGLE_CLIENT_ID=your client id
  GOOGLE_CLIENT_SECRET=your client secret
  GOOGLE_REDIRECT_URI=https://YOUR-SERVICE.onrender.com/auth/google/callback
  SESSION_SECRET=a long random value
  NODE_ENV=production

QR LOGIN
The computer creates a one-time QR code. Scan it on a phone. The phone opens Google's real OAuth page, where Google may offer a passkey, fingerprint, face unlock, PIN, or another method. After authorization, the desktop session connects automatically. Pairing codes expire after 10 minutes and can only be used once.

IMPORTANT
A web app cannot force Google to show a QR code or passkey. Google selects the available sign-in methods. This project provides the secure cross-device QR pairing screen and sends authentication to Google.
