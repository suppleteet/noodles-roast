/**
 * One-time Google Drive OAuth refresh-token minter.
 *
 * Setup (do once in Google Cloud Console):
 *   1. Create a project (or reuse an existing one).
 *   2. Enable the "Google Drive API" for that project.
 *   3. Configure the OAuth consent screen (External, in Testing mode is fine).
 *      Add yourself as a Test User.
 *   4. Credentials -> Create credentials -> OAuth client ID -> "Desktop app".
 *   5. Copy the client ID and client secret into .env.local:
 *        GOOGLE_DRIVE_CLIENT_ID=...
 *        GOOGLE_DRIVE_CLIENT_SECRET=...
 *
 * Then run:
 *   node scripts/google-drive-auth.mjs
 *
 * Browser opens, you approve, script prints the refresh token to paste back
 * into .env.local as GOOGLE_DRIVE_REFRESH_TOKEN.
 */

import { readFileSync } from "fs";
import { createServer } from "http";
import { google } from "googleapis";

try {
  const env = readFileSync(".env.local", "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
} catch { /* no .env.local */ }

const CLIENT_ID = process.env.GOOGLE_DRIVE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
const REDIRECT_PORT = 53682;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`;
const SCOPES = ["https://www.googleapis.com/auth/drive.file"];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing GOOGLE_DRIVE_CLIENT_ID or GOOGLE_DRIVE_CLIENT_SECRET in .env.local");
  console.error("See the header comment in this file for setup instructions.");
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: SCOPES,
});

const server = createServer(async (req, res) => {
  if (!req.url?.startsWith("/oauth2callback")) {
    res.writeHead(404).end();
    return;
  }
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");

  if (err || !code) {
    res.writeHead(400, { "content-type": "text/plain" });
    res.end(`Auth failed: ${err ?? "no code"}`);
    server.close();
    process.exit(1);
  }

  try {
    const { tokens } = await oauth2.getToken(code);
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<h1>Auth complete</h1><p>You can close this tab and return to the terminal.</p>");
    server.close();

    console.log("\nSUCCESS. Paste this into .env.local:\n");
    console.log(`GOOGLE_DRIVE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log(`GOOGLE_DRIVE_FOLDER_ID=1W5-3ciAzFXeLJ1GEF3jz6it3lvD52LUP`);
    console.log("");
    if (!tokens.refresh_token) {
      console.warn("WARNING: no refresh_token returned. This usually means you have already");
      console.warn("granted access to this OAuth client. Revoke it at");
      console.warn("https://myaccount.google.com/permissions and re-run.");
    }
    process.exit(0);
  } catch (e) {
    // Don't echo the raw error to the browser — Google's error responses can
    // include the auth code or client_secret hints in stack traces.
    console.error("Token exchange failed:", e);
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("Token exchange failed. Check the terminal for details.");
    server.close();
    process.exit(1);
  }
});

server.listen(REDIRECT_PORT, () => {
  console.log(`Listening on ${REDIRECT_URI}`);
  console.log("\nOpen this URL in your browser and approve:\n");
  console.log(authUrl);
  console.log("");
});
