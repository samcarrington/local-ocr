const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[(.*)]$/, '$1');
}

/**
 * Returns true only when the given URL resolves to a loopback host.
 * Used by local-only OCR adapters to guarantee no image bytes leave the machine.
 */
export function isLocalHost(host: string): boolean {
  try {
    return LOCAL_HOSTNAMES.has(normalizeHostname(new URL(host).hostname));
  } catch {
    return false;
  }
}

/**
 * Throws when `host` is not loopback. `errorPrefix` names the adapter/host so the
 * thrown message reads naturally, e.g.
 * `"DeepSeek OCR requires local Ollama host (localhost, 127.0.0.1, or ::1). Received: ..."`.
 */
export function assertLocalHost(host: string, errorPrefix: string): void {
  if (!isLocalHost(host)) {
    throw new Error(`${errorPrefix} (localhost, 127.0.0.1, or ::1). Received: ${host}`);
  }
}
