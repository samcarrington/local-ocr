import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

const runtimeDir = path.resolve('e2e/.runtime');
const inboxDir = path.join(runtimeDir, 'inbox');

test.beforeEach(async () => {
  await rm(runtimeDir, { recursive: true, force: true });
  await mkdir(inboxDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(inboxDir, 'report.pdf'), createTextPdf('Phase eight PDF review verification.')),
    writeFile(
      path.join(inboxDir, 'notes.rtf'),
      '{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Times New Roman;}}\\f0\\fs24 Phase eight document conversion verification.}',
    ),
  ]);
});

test.afterAll(async () => {
  await rm(runtimeDir, { recursive: true, force: true });
});

test('reviews, accepts, and commits a PDF through Nuxt and Nitro', async ({ page }) => {
  await expectInbox(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Review pages from report.pdf' }).click();
  await expect(page.getByText('Draft ready for report.pdf.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Source preview' })).toBeVisible();
  await page.getByRole('button', { name: 'Accept page' }).click();
  await expect(page.getByText('Accepted page 1.')).toBeVisible();
  await page.getByRole('button', { name: 'Commit accepted' }).click();
  await expect(page.getByText('Select an inbox file to start.')).toBeVisible();
  await Promise.all([
    access(path.join(inboxDir, 'processed', 'report.pdf')),
    access(path.join(inboxDir, 'report', 'report.md')),
  ]);
});

test('converts, accepts, and commits a document through Nuxt and Nitro', async ({ page }) => {
  await expectInbox(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'notes.rtf' }).click();
  await expect(page.getByText('Whole document')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Source preview' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Accept document' }).click();
  await expect(page.getByText('Accepted page 1.')).toBeVisible();
  await page.getByRole('button', { name: 'Commit accepted' }).click();
  await expect(page.getByText('Select an inbox file to start.')).toBeVisible();
  await Promise.all([
    access(path.join(inboxDir, 'processed', 'notes.rtf')),
    access(path.join(inboxDir, 'notes--rtf', 'notes--rtf.md')),
  ]);
});

function createTextPdf(text: string): Buffer {
  const stream = `BT\n/F1 18 Tf\n72 720 Td\n(${text.replace(/[()\\]/g, '\\$&')}) Tj\nET\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
}

async function expectInbox(page: Page) {
  const response = await page.request.get('/api/pdfs');
  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toEqual({ pdfs: ['report.pdf'] });
}
