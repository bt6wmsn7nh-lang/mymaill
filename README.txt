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
