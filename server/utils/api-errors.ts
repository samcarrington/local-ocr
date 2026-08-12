export interface ApiError extends Error { statusCode: number; }

export function createApiError(statusCode: number, message: string): ApiError {
  const error = new Error(message) as ApiError;
  error.statusCode = statusCode;
  return error;
}

export function getApiErrorStatus(error: unknown): number {
  if (error && typeof error === 'object' && 'statusCode' in error) {
    const status = (error as { statusCode?: unknown }).statusCode;
    if (typeof status === 'number') return status;
  }
  if (error instanceof SyntaxError && 'body' in error) return 400;
  return 500;
}

export function apiErrorBody(error: unknown): { statusCode: number; body: { error: string } } {
  const statusCode = getApiErrorStatus(error);
  return {
    statusCode,
    body: { error: statusCode >= 500 ? 'Internal server error' : error instanceof Error ? error.message : 'Internal server error' },
  };
}

export function logUnexpectedApiError(context: string, error: unknown): void {
  if (getApiErrorStatus(error) < 500) return;
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(`[api] ${context} -> 500: ${detail}`);
}
