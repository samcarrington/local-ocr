import { isAllowedHostHeader } from '../../src/phase2/host-guard-utils.js';

export default defineEventHandler((event) => {
  if (!isAllowedHostHeader(getHeader(event, 'host'))) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Host header rejected',
    });
  }
});
