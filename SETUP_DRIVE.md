# Setting up Google Drive sync

The app uses Google Drive to sync between devices (e.g. phone at the festival,
desktop at home). Drive integration needs a one-time setup in Google Cloud
Console to get an OAuth client ID. Without it, the Sync screen shows a
"not configured" notice and everything else still works offline.

## What you'll get

A Google OAuth client ID string that looks like
`123456789-abcdef.apps.googleusercontent.com`. Pass it at build time as the
`VITE_GOOGLE_CLIENT_ID` environment variable, and the Sync screen lights up.

## Steps

1. **Go to https://console.cloud.google.com/** and sign in with whichever
   Google account you want to be the OAuth "publisher" (the email shown to
   users on the consent screen).
2. **Create a project** ("New Project" → name it e.g. "Clockwork Traveler").
3. **Enable the Drive API:** APIs & Services → Library → search "Google Drive
   API" → Enable.
4. **Configure the OAuth consent screen:**
   - User type: External
   - App name: Clockwork Traveler
   - User support email + developer contact: your email
   - Authorized domains: leave blank for now
   - Scopes: add `.../auth/drive.file` ("See, edit, create, and delete only the
     specific Google Drive files you use with this app")
   - Test users: add the Google account she'll use the app with
   - Save. (Publishing for verification is optional — see "Verification" below.)
5. **Create an OAuth 2.0 client ID:** APIs & Services → Credentials → Create
   Credentials → OAuth client ID
   - Application type: **Web application**
   - Name: anything
   - Authorized JavaScript origins:
     - `https://examungus-code.github.io` (for the Pages deployment)
     - `http://localhost:5173` (for local dev)
   - Authorized redirect URIs: leave blank (Google Identity Services token flow
     doesn't use redirects)
   - Create → copy the **Client ID**.

## Plumbing the client ID into builds

### For local dev
Create a file `.env.local` in the project root:
```
VITE_GOOGLE_CLIENT_ID=123456789-abcdef.apps.googleusercontent.com
```
Then `npm run dev` — sign-in will work in localhost.

### For the deployed site (GitHub Pages)
The GitHub Actions workflow reads `VITE_GOOGLE_CLIENT_ID` from a repo secret:

1. Repo Settings → Secrets and variables → Actions → New repository secret
2. Name: `VITE_GOOGLE_CLIENT_ID`
3. Value: your client ID
4. Save → next deploy picks it up.

## Verification

While the app is in "Testing" status on the consent screen, only added test
users can sign in, AND they'll see an "unverified app" warning where they have
to click "Advanced → Go to Clockwork Traveler (unsafe)" to proceed. Ugly but
functional.

To remove the warning, submit for verification:
- App home page URL (the Pages URL)
- Privacy policy URL (a public page describing what data you collect)
- A demo video showing the OAuth flow
- Justification for the `drive.file` scope (you only touch files the app
  creates)

Drive.file is a relatively easy scope to get approved — usually takes a few
days. Not required for personal use.
