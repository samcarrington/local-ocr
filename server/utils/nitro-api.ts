import {
  apiErrorBody,
  logUnexpectedApiError,
} from './api-errors.js';

type NitroHandler<Result> = (event: any) => Result | Promise<Result>;

export function apiRoute<Result>(handler: NitroHandler<Result>) {
  return defineEventHandler(async (event) => {
    try {
      return await handler(event);
    } catch (error) {
      const { body, statusCode } = apiErrorBody(error);
      logUnexpectedApiError(`${event.method} ${event.path}`, error);
      throw createError({
        statusCode,
        statusMessage: body.error,
        data: body,
      });
    }
  });
}

export function setStatus(event: any, statusCode: number): void {
  event.node.res.statusCode = statusCode;
}

export function previewResponse(event: any, preview: {
  contentType: string;
  data: Buffer;
}): Buffer {
  setResponseHeader(event, 'content-type', preview.contentType);
  return preview.data;
}
