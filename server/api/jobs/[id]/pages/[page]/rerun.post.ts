import { getOcrService } from '../../../../../services/ocr-runtime.js';
import { apiRoute } from '../../../../../utils/nitro-api.js';

export default apiRoute(async (event) =>
  getOcrService().rerun(
    getRouterParam(event, 'id') ?? '',
    getRouterParam(event, 'page') ?? '',
    await readBody(event),
  ),
);
