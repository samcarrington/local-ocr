import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { assertLocalHost, isLocalHost } from './local-host.js';

const AVAILABILITY_TIMEOUT_MS = 1_500;
const DEFAULT_CHAT_TIMEOUT_MS = 180_000;
const MODELS_ENDPOINTS = ['/v1/models', '/models'] as const;
const CHAT_COMPLETION_ENDPOINTS = [
  '/v1/chat/completions',
  '/chat/completions',
] as const;

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

type ModelsResponse = {
  data?: Array<{ id?: unknown }>;
};

type LocalMlxVlmConfig = {
  serverHost: string;
  model: string;
  chatTimeoutMs?: number;
};

export abstract class LocalMlxVlmOpenAiAdapter<
  TConfig extends LocalMlxVlmConfig,
> {
  protected constructor(
    protected readonly config: TConfig,
    private readonly localHostErrorPrefix: string,
    private readonly adapterName: string,
  ) {}

  async isAvailable(): Promise<boolean> {
    if (!isLocalHost(this.config.serverHost)) {
      return false;
    }

    try {
      return await this.withTimeout(
        AVAILABILITY_TIMEOUT_MS,
        async (signal) => {
          const response = await this.fetchFirstOkResponse(
            MODELS_ENDPOINTS,
            (endpoint) =>
              fetch(this.resolveUrl(endpoint), {
                method: 'GET',
                signal,
              }),
          );

          if (!response) {
            return false;
          }

          if (!response.ok) {
            return false;
          }

          const payload = (await response.json()) as ModelsResponse;
          return listModelIds(payload).includes(
            normalizeModelName(this.config.model),
          );
        },
      );
    } catch {
      return false;
    }
  }

  protected async requestImageChatCompletion(
    imagePath: string,
    createPayload: (dataUrl: string) => unknown,
  ): Promise<string | null | undefined> {
    assertLocalHost(this.config.serverHost, this.localHostErrorPrefix);

    const dataUrl = await readImageAsDataUrl(imagePath);
    const response = await this.fetchChatCompletion(createPayload(dataUrl));
    const payload = (await response.json()) as ChatCompletionResponse;
    return payload.choices?.[0]?.message?.content;
  }

  protected resolveUrl(pathname: string): string {
    return new URL(
      pathname,
      withTrailingSlash(this.config.serverHost),
    ).toString();
  }

  private async fetchChatCompletion(payload: unknown): Promise<Response> {
    const timeoutMs = this.config.chatTimeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS;

    try {
      const response = await this.withTimeout(timeoutMs, async (signal) => {
        const endpointResponse = await this.fetchFirstOkResponse(
          CHAT_COMPLETION_ENDPOINTS,
          async (endpoint) =>
            fetch(this.resolveUrl(endpoint), {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
              },
              body: JSON.stringify(payload),
              signal,
            }),
        );

        if (!endpointResponse) {
          throw new Error('No compatible chat completion endpoint found');
        }

        return endpointResponse;
      });

      if (!response.ok) {
        const details = await safeResponseText(response);
        throw new Error(
          `${this.adapterName} request failed (${response.status} ${response.statusText})${details ? `: ${details}` : ''}`,
        );
      }

      return response;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${this.adapterName} unavailable at ${this.config.serverHost}: ${reason}`,
      );
    }
  }

  private async fetchFirstOkResponse(
    endpoints: readonly string[],
    fetcher: (endpoint: string) => Promise<Response>,
  ): Promise<Response | null> {
    let lastResponse: Response | null = null;

    for (const endpoint of endpoints) {
      const response = await fetcher(endpoint);

      if (response.status !== 404) {
        return response;
      }

      lastResponse = response;
    }

    return lastResponse;
  }

  private async withTimeout<T>(
    timeoutMs: number,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await operation(controller.signal);
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function readImageAsDataUrl(imagePath: string): Promise<string> {
  const base64 = await readFile(imagePath, { encoding: 'base64' });
  const mime =
    MIME_BY_EXTENSION[path.extname(imagePath).toLowerCase()] ?? 'image/png';
  return `data:${mime};base64,${base64}`;
}

function listModelIds(payload: ModelsResponse): string[] {
  return (payload.data ?? [])
    .map((model) => model.id)
    .filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    )
    .map(normalizeModelName);
}

function normalizeModelName(name: string): string {
  return name.trim().toLowerCase();
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch {
    return '';
  }
}

function withTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}
