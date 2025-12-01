# ✅ iOS EAS Build Readiness Checklist (Legacy Yoga Setup)

This document outlines the full setup required to successfully build the iOS version of your app with legacy Yoga and no Fabric using EAS.

---

## 🔧 Codebase Requirements

### 📦 Dependencies (package.json)
- `react-native`: `0.82.1`
- `expo`: `54.0.22`
- `react-native-yoga`: `"npm:yoga-layout@3.2.1"` (aliased)
- `react-native-reanimated`: `3.10.1`
- `react-native-gesture-handler`: `2.20.0`
- `react-native-screens`: `3.31.1`
- `react-native-safe-area-context`: `4.8.2`
- `react-native-svg`: `15.2.0`
- `@react-navigation/native`: `^6.1.10`
- `expo-build-properties`: `0.12.3`

### 🛠️ Postinstall Script
Ensure `patch-package` is wired in:
```json
"scripts": {
  "postinstall": "patch-package"
}
```

---

## 🧩 Plugin Configuration (app.json)

```json
{
  "expo": {
    "plugins": [
      "./app.plugin.js",
      [
        "expo-build-properties",
        {
          "ios": {
            "deploymentTarget": "15.1",
            "useFrameworks": "static"
          }
        }
      ]
    ]
  }
}
```

---

## 📄 app.plugin.js (injects to Podfile)

Ensure the following is injected:
```ruby
ENV['RCT_NEW_ARCH_ENABLED'] = '0'

use_react_native!(
  :path => config[:reactNativePath],
  :fabric_enabled => false,
  :hermes_enabled => false
)

use_frameworks! :static
```

---

## 📦 Patch Setup

Create file: `patches/react-native+0.82.1.patch` to override `react_native_pods.rb`
Run `patch-package` after install.

---

## 📁 Clean State Before Build

```bash
rm -rf node_modules package-lock.json ios android .expo .expo-shared
npm install
npx expo prebuild --clean
```

---

## 🧪 Build Command (PowerShell)

```powershell
$env:EAS_SKIP_AUTO_FINGERPRINT="1"
$env:EAS_FORCE_NPM_REINSTALL="1"
$env:EXPO_NO_LEGACY_YOGA="0"
eas build -p ios --profile production
```

---

## 📌 Final Notes

- Always ensure `eas-cli` is up-to-date:
```bash
npm install -g eas-cli
```
- Review build logs for Podfile confirmation:
  - `RCT_NEW_ARCH_ENABLED = '0'`
  - `fabric_enabled: false`
  - `hermes_enabled: false`
  - `use_frameworks! :static`

---

✅ If all of the above is confirmed, your iOS build should succeed via EAS.
