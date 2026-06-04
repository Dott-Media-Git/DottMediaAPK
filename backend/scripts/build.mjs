import { promises as fs } from 'fs';
import path from 'path';
import ts from 'typescript';

const rootDir = path.resolve('src');
const outDir = path.resolve('dist');

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

async function buildTsFile(filePath) {
  const source = await fs.readFile(filePath, 'utf8');
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ES2020,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      esModuleInterop: true,
      isolatedModules: true,
      resolveJsonModule: true,
      sourceMap: false,
    },
    fileName: filePath,
    reportDiagnostics: true,
  });

  const blockingDiagnostics = result.diagnostics?.filter(
    diagnostic => diagnostic.category === ts.DiagnosticCategory.Error,
  );

  if (blockingDiagnostics?.length) {
    const formatted = ts.formatDiagnosticsWithColorAndContext(blockingDiagnostics, {
      getCanonicalFileName: fileName => fileName,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => '\n',
    });
    throw new Error(formatted);
  }

  const relativePath = path.relative(rootDir, filePath).replace(/\.ts$/, '.js');
  await writeFile(path.join(outDir, relativePath), result.outputText);
}

async function copyAsset(filePath) {
  const relativePath = path.relative(rootDir, filePath);
  const destination = path.join(outDir, relativePath);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(filePath, destination);
}

async function main() {
  await fs.rm(outDir, { recursive: true, force: true });
  const files = await walk(rootDir);
  const tsFiles = files.filter(file => file.endsWith('.ts'));
  const assetFiles = files.filter(file => !file.endsWith('.ts'));

  for (const file of tsFiles) {
    await buildTsFile(file);
  }

  for (const file of assetFiles) {
    await copyAsset(file);
  }

  console.log(`Built ${tsFiles.length} TypeScript files and copied ${assetFiles.length} assets.`);
}

await main().catch(error => {
  console.error('Backend build failed:', error);
  process.exitCode = 1;
});
