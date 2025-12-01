// Keeps Expo prebuild aligned with the Yoga headers shipped in React Native 0.82.1 by
// forcing legacy architecture flags and static frameworks into the generated Podfile.
const { withPodfile } = require('@expo/config-plugins');

function ensureNewArchDisabled(podfileContents) {
  const envBlock = "ENV['RCT_NEW_ARCH_ENABLED'] = '0'\nENV['RCT_FABRIC_ENABLED'] = '0'\n";
  if (podfileContents.includes("ENV['RCT_NEW_ARCH_ENABLED']")) {
    return podfileContents;
  }

  const requirePattern = /(require\s+['\"].*react-native.*['\"]\s*\n)/;
  if (requirePattern.test(podfileContents)) {
    return podfileContents.replace(requirePattern, `$1${envBlock}`);
  }

  return `${envBlock}${podfileContents}`;
}

function injectReactNativeOptions(podfileContents) {
  const useReactNativeRegex = /use_react_native!\s*\(\s*([^)]*?)\)/m;
  const match = podfileContents.match(useReactNativeRegex);

  if (!match) {
    return podfileContents;
  }

  const rawOptions = match[1];
  const parts = rawOptions
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  const optionsMap = {};
  const seenOrder = [];

  parts.forEach((p) => {
    const rocket = p.match(/^:?(\w+)\s*=>\s*(.+)$/);
    const colon = p.match(/^(\w+):\s*(.+)$/);
    const pair = rocket || colon;
    if (pair) {
      const key = pair[1];
      const value = pair[2];
      if (!optionsMap[key]) {
        seenOrder.push(key);
      }
      optionsMap[key] = value;
    }
  });

  optionsMap['path'] = 'config[:reactNativePath]';
  optionsMap['fabric_enabled'] = 'false';
  optionsMap['hermes_enabled'] = 'false';
  optionsMap['new_arch_enabled'] = 'false';

  const priorityOrder = ['path', 'fabric_enabled', 'hermes_enabled', 'new_arch_enabled'];
  const orderedKeys = [
    ...priorityOrder,
    ...seenOrder.filter((k) => !priorityOrder.includes(k)),
  ];

  const rebuilt = orderedKeys
    .map((key) => optionsMap[key])
    .filter(Boolean)
    .map((value, idx) => {
      const key = orderedKeys[idx];
      return `:${key} => ${value}`;
    })
    .join(',\n  ');

  const replacement = `use_react_native!(\n  ${rebuilt}\n)`;
  return podfileContents.replace(useReactNativeRegex, replacement);
}

function ensureUseFrameworksStatic(podfileContents) {
  const staticPattern = /use_frameworks!\s*:linkage\s*=>\s*:static/;
  if (staticPattern.test(podfileContents)) {
    return podfileContents;
  }

  if (podfileContents.includes('use_frameworks!')) {
    return podfileContents.replace(/use_frameworks!.*\n/, 'use_frameworks! :linkage => :static\n');
  }

  const platformRegex = /(platform\s*:ios[^\n]*\n)/;
  if (platformRegex.test(podfileContents)) {
    return podfileContents.replace(platformRegex, `$1use_frameworks! :linkage => :static\n`);
  }

  return `use_frameworks! :linkage => :static\n${podfileContents}`;
}

const withYogaAlignment = (config) =>
  withPodfile(config, (modConfig) => {
    let contents = modConfig.modResults.contents;
    contents = ensureNewArchDisabled(contents);
    contents = injectReactNativeOptions(contents);
    contents = ensureUseFrameworksStatic(contents);
    modConfig.modResults.contents = contents;
    return modConfig;
  });

module.exports = withYogaAlignment;
