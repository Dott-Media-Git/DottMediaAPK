# Deep Fix for EAS iOS Build “Install Pods” Failure

This document captures the steps to keep EAS iOS builds stable with Expo 54, React Native 0.82.1, legacy architecture/Yoga, Hermes off, and static frameworks.

---

## Objective

Prevent `Install pods` failures during `eas build -p ios --profile production` while using:
- React Native: 0.82.1
- Expo SDK: 54.0.22
- Legacy Yoga, Hermes disabled
- Static frameworks
- iOS deployment target: 15.1

---

## Tasks for the Codebase

### 1) `app.plugin.js`: Inject legacy build config into Podfile
Ensure the generated `ios/Podfile` gets:
```rb
ENV['RCT_NEW_ARCH_ENABLED'] = '0'
```
Rewrite the `use_react_native!` call to:
```rb
use_react_native!(
  :path => config[:reactNativePath],
  :fabric_enabled => false,
  :hermes_enabled => false,
  :yoga_version => '1.14.0',
  :yoga_path => '../node_modules/react-native/ReactCommon/yoga'
)
```
Also ensure:
```rb
use_frameworks! :linkage => :static
```
is present and not wrapped in conditionals.

### 2) `app.json` plugin configuration
Plugin order must be:
```json
{
  "expo": {
    "plugins": [
      "./app.plugin.js",
      ["expo-build-properties", {
        "ios": {
          "deploymentTarget": "15.1",
          "useFrameworks": "static"
        }
      }]
    ]
  }
}
```

### 3) `patch-package` for `react-native`
`patches/react-native+0.82.1.patch` must modify `node_modules/react-native/scripts/react_native_pods.rb` to respect `ENV['RCT_NEW_ARCH_ENABLED'] = '0'` and disable Fabric and Hermes when that flag is set. `package.json` should include:
```json
"scripts": {
  "postinstall": "patch-package"
}
```

### 4) Clean and rebuild native projects
```sh
rm -rf ios android .expo .expo-shared node_modules package-lock.json
npm install
npx expo prebuild --clean
```
Then verify the generated `ios/Podfile` includes all flags.

### 5) Rebuild on EAS
Set env for production builds:
```sh
$env:EAS_SKIP_AUTO_FINGERPRINT="1"
$env:EAS_FORCE_NPM_REINSTALL="1"
$env:EXPO_NO_LEGACY_YOGA="0"
eas build -p ios --profile production
```
Or the equivalent in `eas.json`:
```json
"env": {
  "EAS_SKIP_AUTO_FINGERPRINT": "1",
  "EAS_FORCE_NPM_REINSTALL": "1",
  "EXPO_NO_LEGACY_YOGA": "0"
}
```

---

## Verify Podfile
Before shipping to EAS, confirm `ios/Podfile` contains:
- `ENV['RCT_NEW_ARCH_ENABLED'] = '0'`
- `use_frameworks! :static`
- `use_react_native!(... :fabric_enabled => false, :hermes_enabled => false ...)`

---

## References
- Expo Build Properties Plugin: https://docs.expo.dev/versions/latest/sdk/build-properties/
- EAS Build Environment Variables: https://docs.expo.dev/eas/environment-variables/
- React Native Podfile Docs: https://reactnative.dev/docs/0.82/using-cocoapods
