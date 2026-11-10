import { describe, expect, it } from 'vitest';
import { apiProxyTarget, browserApiEndpoint } from './api-endpoint';

describe('mobile API routing', () => {
  it('uses the same origin for legacy local API settings', () => {
    for (const value of [undefined, 'http://localhost:4000/api', 'http://127.0.0.1:4000/api', 'http://[::1]:4000/api']) {
      expect(browserApiEndpoint(value)).toBe('/api');
    }
  });
  it('preserves configured remote production endpoints and relative proxies', () => {
    expect(browserApiEndpoint('https://api.example.com/api/')).toBe('https://api.example.com/api');
    expect(browserApiEndpoint('/api/')).toBe('/api');
  });
  it('only accepts absolute HTTP proxy destinations', () => {
    expect(apiProxyTarget('/api')).toBe('http://127.0.0.1:4000/api');
    expect(apiProxyTarget('file:///tmp/api')).toBe('http://127.0.0.1:4000/api');
    expect(apiProxyTarget('http://api:4000/api/')).toBe('http://api:4000/api');
  });
});
