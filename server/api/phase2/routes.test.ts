import { beforeEach, describe, expect, it, vi } from 'vitest';

const passthroughDefineEventHandler = <T extends (...args: any[]) => any>(
  handler: T,
): T => handler;

const createErrorStub = (payload: {
  statusCode: number;
  statusMessage: string;
}) => {
  const error = new Error(payload.statusMessage) as Error & {
    statusCode: number;
    statusMessage: string;
  };
  error.statusCode = payload.statusCode;
  error.statusMessage = payload.statusMessage;
  return error;
};

describe('phase2 route contracts', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.stubGlobal('defineEventHandler', passthroughDefineEventHandler);
    vi.stubGlobal('createError', createErrorStub);
  });

  it('returns stable health payload', async () => {
    const module = await import('./health.get.ts');
    const result = await module.default();
    expect(result).toEqual({ ok: true, phase: 2, runtime: 'nuxt-nitro' });
  });

  it('sanitizes unexpected probe failures', async () => {
    vi.doMock('node:fs/promises', () => ({
      readdir: vi.fn(async () => {
        throw new Error('boom /private/path/leak');
      }),
      access: vi.fn(),
      readFile: vi.fn(),
      rm: vi.fn(),
    }));

    vi.doMock('../../../src/core/config.js', () => ({
      loadConfig: vi.fn(() => ({
        inboxPath: '/tmp/does-not-matter',
        engines: { tesseract: { kind: 'tesseract', lang: 'eng' } },
      })),
    }));

    vi.doMock('../../../src/ocr/adapters.js', () => ({
      createOcrAdapterRegistry: vi.fn(() => ({
        getAdapter: vi.fn(() => ({
          isAvailable: vi.fn(async () => true),
        })),
      })),
    }));

    vi.doMock('../../../src/core/pipeline.js', () => ({
      createDraftJob: vi.fn(),
    }));

    vi.doMock('../../../src/convert/anydoc.js', () => ({
      convertDocumentToMarkdown: vi.fn(),
    }));

    const module = await import('./probe.post.ts');
    await expect(module.default()).rejects.toMatchObject({
      statusCode: 500,
      statusMessage: 'Phase 2 probe failed',
    });
  });
});
