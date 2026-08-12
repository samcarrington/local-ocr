import { loadConfig } from '../core/config.js';
import { getOcrtoolConfigPath } from '../utils/runtime-config.js';

export default defineNitroPlugin(() => {
  loadConfig(getOcrtoolConfigPath());
});
