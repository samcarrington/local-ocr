import { describe, expect, it } from 'vitest';

import { formatHttpHost, isLocalHost } from './local-host.js';

describe('isLocalHost', () => {
  it('accepts localhost, IPv4 loopback, and bracketed IPv6 loopback', () => {
    expect(isLocalHost('http://localhost:8080')).toBe(true);
    expect(isLocalHost('http://127.0.0.1:8080')).toBe(true);
    expect(isLocalHost('http://[::1]:8080')).toBe(true);
  });

  it('rejects non-loopback hosts', () => {
    expect(isLocalHost('http://192.168.1.10:8080')).toBe(false);
    expect(isLocalHost('http://[2001:db8::1]:8080')).toBe(false);
  });
});

describe('formatHttpHost', () => {
  it('brackets IPv6 hosts while preserving localhost and IPv4 hosts', () => {
    expect(formatHttpHost('::1', 8080)).toBe('http://[::1]:8080');
    expect(formatHttpHost('[::1]', 8080)).toBe('http://[::1]:8080');
    expect(formatHttpHost('localhost', 8080)).toBe('http://localhost:8080');
    expect(formatHttpHost('127.0.0.1', 8080)).toBe('http://127.0.0.1:8080');
  });
});
