export function getOcrtoolConfigPath(): string | undefined {
  const value = useRuntimeConfig().ocrtoolConfigPath;
  return typeof value === 'string' && value.trim() ? value : undefined;
}
