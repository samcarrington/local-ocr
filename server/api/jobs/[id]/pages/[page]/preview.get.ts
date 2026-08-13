import { getOcrService } from '../../../../../services/ocr-runtime.js';
import { apiRoute, previewResponse } from '../../../../../utils/nitro-api.js';

export default apiRoute(async (event) =>
  previewResponse(
    event,
    await getOcrService().getPreview(
      getRouterParam(event, 'id') ?? '',
      getRouterParam(event, 'page') ?? '',
    ),
  ),
);
