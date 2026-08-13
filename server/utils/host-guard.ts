const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export function normalizeHost(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('[')) {
    const close = trimmed.indexOf(']');
    if (close > 1) {
      return trimmed.slice(1, close).toLowerCase();
    }
  }

  const [hostname] = trimmed.split(':');
  return hostname ? hostname.toLowerCase() : null;
}

export function isAllowedHostHeader(value: string | undefined): boolean {
  const host = normalizeHost(value);
  return host ? LOCAL_HOSTS.has(host) : false;
}
