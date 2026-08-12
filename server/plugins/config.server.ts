import { loadConfig } from '../core/config.js';

export default defineNitroPlugin(() => {
  loadConfig();
});
