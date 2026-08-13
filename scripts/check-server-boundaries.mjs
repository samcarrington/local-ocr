import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const sourceDirectories = ['app', 'shared'];
const sourceFilePattern = /\.(?:[cm]?[jt]s|vue)$/;
const importPattern =
  /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;

const files = await Promise.all(
  sourceDirectories.map((directory) => findSourceFiles(path.join(rootDir, directory))),
);
const violations = [];

for (const filePath of files.flat()) {
  const source = await readFile(filePath, 'utf8');
  for (const specifier of source.matchAll(importPattern)) {
    if (resolvesIntoServer(specifier[1], filePath)) {
      violations.push(
        `${path.relative(rootDir, filePath)} imports ${specifier[1]}`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error('Forbidden imports into server/:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
}

async function findSourceFiles(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(
      entries.map((entry) => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          return findSourceFiles(entryPath);
        }
        return entry.isFile() && sourceFilePattern.test(entry.name)
          ? [entryPath]
          : [];
      }),
    );
    return files.flat();
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function resolvesIntoServer(specifier, importerPath) {
  if (specifier.startsWith('~/') || specifier.startsWith('@/')) {
    return path.resolve(rootDir, specifier.slice(2)).startsWith(
      `${path.join(rootDir, 'server')}${path.sep}`,
    );
  }

  if (!specifier.startsWith('.')) {
    return false;
  }

  return path.resolve(path.dirname(importerPath), specifier).startsWith(
    `${path.join(rootDir, 'server')}${path.sep}`,
  );
}
