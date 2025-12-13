import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '..', 'dist');
const skipExtRegex = /\.(?:js|cjs|mjs|json|node)$/;

const patterns = [
  { regex: /(from\s+['"])(\.{1,2}\/[^'"]*)(['"])/g },
  { regex: /(import\s+['"])(\.{1,2}\/[^'"]*)(['"])/g },
  { regex: /(import\s*\(\s*['"])(\.{1,2}\/[^'"]*)(['"])(\s*\))/g, includeSuffix: true },
];

const processedFiles = [];

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  await Promise.all(
    entries.map(async entry => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        return;
      }
      if (entry.isFile() && entry.name.endsWith('.js')) {
        await processFile(fullPath);
      }
    }),
  );
}

function rewriteImports(source) {
  let modified = false;
  let content = source;

  const replaceWith = ({ regex, includeSuffix = false }) =>
    (content = content.replace(regex, (...args) => {
      const match = args[0];
      const prefix = args[1];
      const specifier = args[2];
      const quote = args[3];
      const suffix = includeSuffix ? args[4] ?? '' : '';
      if (!specifier.startsWith('.')) {
        return match;
      }
      if (skipExtRegex.test(specifier)) {
        return match;
      }
      modified = true;
      return `${prefix}${specifier}.js${quote}${suffix}`;
    }));

  patterns.forEach(pattern => replaceWith(pattern));

  return { content, modified };
}

async function processFile(filePath) {
  const original = await fs.readFile(filePath, 'utf8');
  const { content, modified } = rewriteImports(original);
  if (modified) {
    await fs.writeFile(filePath, content, 'utf8');
    processedFiles.push(path.relative(distDir, filePath));
  }
}

async function main() {
  try {
    await walk(distDir);
    console.log(`Patched ${processedFiles.length} files with explicit .js extensions.`);
  } catch (error) {
    console.error('Failed to patch ESM extensions:', error);
    process.exitCode = 1;
  }
}

await main();
