const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourceDir = path.join(root, 'docs');
const destDir = path.join(root, 'dist', 'help');

if (!fs.existsSync(sourceDir)) {
  console.error(`Help docs source not found: ${sourceDir}`);
  process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });

const files = fs
  .readdirSync(sourceDir)
  .filter((name) => {
    const lower = name.toLowerCase();
    return lower.endsWith('.pdf') || lower.endsWith('.html');
  });

if (!files.length) {
  console.warn('No PDF help docs found to copy.');
  process.exit(0);
}

files.forEach((file) => {
  fs.copyFileSync(path.join(sourceDir, file), path.join(destDir, file));
});

const logoSource = path.join(root, 'assets', 'logo.png');
if (fs.existsSync(logoSource)) {
  fs.copyFileSync(logoSource, path.join(destDir, 'logo.png'));
}

console.log(`Copied ${files.length} help docs to ${destDir}`);
