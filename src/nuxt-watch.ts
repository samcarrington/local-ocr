import path from 'node:path';

const WATCHED_ROOTS = new Set(['app', 'server', 'shared', 'src']);

export function isDevelopmentWatchPathIgnored(
  watchPath: string,
  rootDir: string = process.cwd(),
): boolean {
  const relativePath = path.relative(rootDir, watchPath);

  if (!relativePath) {
    return false;
  }

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return true;
  }

  const [root] = relativePath.split(path.sep);
  return !WATCHED_ROOTS.has(root);
}
