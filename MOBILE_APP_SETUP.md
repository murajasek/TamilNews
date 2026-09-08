# Mobile App Setup (iOS + Android)

This project can be packaged as a native app using Capacitor.

## Prerequisites

- Node.js 18+
- Xcode (for iOS)
- Android Studio (for Android)

## 1) Choose the web URL your mobile app should load

Set `CAP_SERVER_URL` to either:

- A deployed HTTPS URL (recommended for production), or
- Your local LAN URL during development (same Wi-Fi), e.g. `http://192.168.1.102:3000`

## 2) Install dependencies

```bash
npm install
```

## 3) Add native platforms (one-time)

```bash
npm run cap:add:ios
npm run cap:add:android
```

## 4) Sync native projects with Capacitor config

```bash
CAP_SERVER_URL=https://your-deployed-domain.com npm run cap:sync
```

For local testing on phone:

```bash
CAP_SERVER_URL=http://192.168.1.102:3000 npm run cap:sync
```

## 5) Open native projects

```bash
npm run cap:open:ios
npm run cap:open:android
```

Then run from Xcode/Android Studio to install on simulator/device.

## Notes

- Your Next.js server must be reachable from device when using a LAN URL.
- For production App Store / Play Store builds, use a stable HTTPS domain in `CAP_SERVER_URL`.
- Browser and mobile web app/PWA support is already available at `manifest.webmanifest` and `sw.js`.
