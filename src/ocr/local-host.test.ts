import { describe, expect, it } from 'vitest';

import { isLocalHost } from './local-host.js';

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
