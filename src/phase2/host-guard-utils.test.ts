import { describe, expect, it } from 'vitest';

import { isAllowedHostHeader, normalizeHost } from './host-guard-utils.js';

describe('host-guard utils', () => {
  it('normalizes plain and bracketed hosts', () => {
    expect(normalizeHost('localhost:3000')).toBe('localhost');
    expect(normalizeHost('127.0.0.1:4312')).toBe('127.0.0.1');
    expect(normalizeHost('[::1]:3000')).toBe('::1');
    expect(normalizeHost('')).toBeNull();
    expect(normalizeHost(undefined)).toBeNull();
  });

  it('allows only loopback hosts', () => {
    expect(isAllowedHostHeader('localhost')).toBe(true);
    expect(isAllowedHostHeader('127.0.0.1')).toBe(true);
    expect(isAllowedHostHeader('[::1]:3000')).toBe(true);
    expect(isAllowedHostHeader('evil.example')).toBe(false);
    expect(isAllowedHostHeader('10.0.0.1')).toBe(false);
    expect(isAllowedHostHeader(undefined)).toBe(false);
  });
});
