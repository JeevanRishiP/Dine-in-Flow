import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EvolutionAdapter } from '../evolution.adapter.js';

describe('EvolutionAdapter (Instance Isolation & Safety)', () => {
  let adapter: EvolutionAdapter;
  const baseUrl = 'http://localhost:8080';
  const apiKey = 'test-api-key-123';
  const instanceName = 'dineflow_isolated';

  beforeEach(() => {
    adapter = new EvolutionAdapter({
      baseUrl,
      apiKey,
      instanceName,
    });
  });

  it('scopes all requests strictly to the configured instanceName', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ key: { id: 'evo-msg-456' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await adapter.sendTemplate({
      to: '+91 98765 43210',
      templateName: 'auth_otp_v1',
      category: 'AUTHENTICATION',
      params: { code: '123456' },
      orgId: 'org-1',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [callUrl, callInit] = fetchMock.mock.calls[0];

    // Must call ONLY /message/sendText/dineflow_isolated
    expect(callUrl).toBe('http://localhost:8080/message/sendText/dineflow_isolated');
    expect(callInit.headers['apikey']).toBe(apiKey);

    const body = JSON.parse(callInit.body);
    // Number must be cleaned of non-digits
    expect(body.number).toBe('919876543210');
    expect(body.text).toContain('123456');

    expect(result.status).toBe('SENT');
    expect(result.providerMessageId).toBe('evo-msg-456');
    expect(result.provider).toBe('EVOLUTION');
  });

  it('handles Evolution API connection or non-200 failure gracefully without throwing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'Instance not connected',
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await adapter.sendTemplate({
      to: '+919876543210',
      templateName: 'auth_otp_v1',
      category: 'AUTHENTICATION',
      params: { code: '123456' },
      orgId: 'org-1',
    });

    expect(result.status).toBe('FAILED');
    expect(result.costMinorPaise).toBe(0n);
  });

  it('handles network timeouts gracefully', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('Connection timed out'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await adapter.sendTemplate({
      to: '+919876543210',
      templateName: 'auth_otp_v1',
      category: 'AUTHENTICATION',
      params: { code: '123456' },
      orgId: 'org-1',
    });

    expect(result.status).toBe('FAILED');
    expect(result.costMinorPaise).toBe(0n);
  });
});
