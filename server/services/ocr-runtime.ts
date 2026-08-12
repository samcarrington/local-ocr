import { loadConfig } from '../core/config.js';
import { createOcrService, type OcrService } from './ocr-service.js';

let service: OcrService | undefined;

export function getOcrService(): OcrService {
  service ??= createOcrService(loadConfig());
  return service;
}
