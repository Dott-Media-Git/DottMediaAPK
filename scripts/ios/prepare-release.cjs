const fs = require('node:fs');

const required = ['APP_STORE_APPLE_ID', 'EXPO_PUBLIC_FIREBASE_API_KEY', 'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN', 'EXPO_PUBLIC_FIREBASE_PROJECT_ID', 'EXPO_PUBLIC_FIREBASE_APP_ID'];
const missing = required.filter(name => !process.env[name]?.trim());
if (missing.length) throw new Error(`Set these variables in the Codemagic dotti_mobile group: ${missing.join(', ')}`);
if (!/^\d+$/.test(process.env.APP_STORE_APPLE_ID)) throw new Error('APP_STORE_APPLE_ID must be the numeric Apple ID from App Store Connect.');
if (process.argv.includes('--check')) {
  console.log('Required release variables are configured.');
  process.exit(0);
}
const build = process.env.IOS_BUILD_NUMBER;
if (!/^\d+$/.test(build || '') || Number(build) < 39) throw new Error('IOS_BUILD_NUMBER must be an integer of at least 39.');
const config = JSON.parse(fs.readFileSync('app.json', 'utf8'));
if (config.expo.ios.bundleIdentifier !== 'com.dottmedia.dottmediaapk') throw new Error('Unexpected iOS bundle identifier.');
config.expo.ios.buildNumber = build;
fs.writeFileSync('app.json', JSON.stringify(config, null, 2) + '\n');
console.log(`Preparing Dotti ${config.expo.version} (${build}).`);
