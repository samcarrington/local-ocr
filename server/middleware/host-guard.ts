import { isAllowedHostHeader } from '../utils/host-guard.js';

export default defineEventHandler((event) => {
  if (!isAllowedHostHeader(getHeader(event, 'host'))) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Host header rejected',
    });
  }
});
