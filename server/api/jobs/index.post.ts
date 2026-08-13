import { getOcrService } from '../../services/ocr-runtime.js';
import { apiRoute, setStatus } from '../../utils/nitro-api.js';

export default apiRoute(async (event) => {
  const result = await getOcrService().createJob(await readBody(event));
  setStatus(event, result.statusCode);
  return result.resumed
    ? { job: result.job, resumed: true }
    : { job: result.job };
});
