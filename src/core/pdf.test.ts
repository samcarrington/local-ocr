import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';

import { computeImageRegions } from './pdf.js';

type Op = [number, unknown[]];

function makeOpList(ops: Op[]): { fnArray: number[]; argsArray: unknown[][] } {
  return {
    fnArray: ops.map(([fn]) => fn),
    argsArray: ops.map(([, args]) => args)
  };
}

const NO_TRANSFORM: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];

const IMAGE_OPERATOR_NAMES = [
  'paintImageXObject',
  'paintInlineImageXObject',
  'paintImageMaskXObject',
  'paintImageMaskXObjectGroup',
  'paintInlineImageXObjectGroup',
  'paintImageXObjectRepeat',
  'paintImageMaskXObjectRepeat'
] as const;

describe('computeImageRegions', () => {
  it('uses only raster image paint operators that exist in the installed pdf.js runtime', () => {
    for (const name of IMAGE_OPERATOR_NAMES) {
      expect(OPS[name], name).toEqual(expect.any(Number));
    }

    expect('paintJpegXObject' in OPS).toBe(false);
    expect('paintInlineImage' in OPS).toBe(false);
  });

  it('maps an image CTM unit square to device pixels', () => {
    const ops = makeOpList([
      [OPS.transform, [100, 0, 0, 50, 10, 20]],
      [OPS.paintImageXObject, ['img_1']]
    ]);

    expect(computeImageRegions(ops, NO_TRANSFORM, 1000, 1000)).toEqual([[10, 20, 110, 70]]);
  });

  it('applies a y-flipping viewport transform', () => {
    const ops = makeOpList([
      [OPS.transform, [100, 0, 0, 50, 10, 20]],
      [OPS.paintImageXObject, ['img_1']]
    ]);

    // Typical pdf.js viewport: scale 1, y-flip, page height 1000.
    expect(computeImageRegions(ops, [1, 0, 0, -1, 0, 1000], 1000, 1000)).toEqual([[10, 930, 110, 980]]);
  });

  it('drops decorative images below the minimum size', () => {
    const ops = makeOpList([
      [OPS.transform, [10, 0, 0, 10, 0, 0]],
      [OPS.paintImageXObject, ['icon']]
    ]);

    expect(computeImageRegions(ops, NO_TRANSFORM, 1000, 1000)).toEqual([]);
  });

  it('restores the transform stack so a later image ignores a popped transform', () => {
    const ops = makeOpList([
      [OPS.transform, [100, 0, 0, 50, 10, 20]],
      [OPS.save, []],
      [OPS.transform, [1, 0, 0, 1, 500, 500]],
      [OPS.restore, []],
      [OPS.paintImageXObject, ['img_1']]
    ]);

    expect(computeImageRegions(ops, NO_TRANSFORM, 1000, 1000)).toEqual([[10, 20, 110, 70]]);
  });

  it('clamps regions to the device bounds', () => {
    const ops = makeOpList([
      [OPS.transform, [2000, 0, 0, 50, 0, 20]],
      [OPS.paintImageXObject, ['wide']]
    ]);

    expect(computeImageRegions(ops, NO_TRANSFORM, 500, 1000)).toEqual([[0, 20, 500, 70]]);
  });

  it('returns every qualifying image in paint order', () => {
    const ops = makeOpList([
      [OPS.transform, [100, 0, 0, 50, 10, 20]],
      [OPS.paintImageXObject, ['img_1']],
      [OPS.transform, [1, 0, 0, 1, 200, 200]],
      [OPS.paintImageXObject, ['img_2']]
    ]);

    // Second image CTM = [100,0,0,50, 10+100*200? ] -> composed; assert count + order only.
    const regions = computeImageRegions(ops, NO_TRANSFORM, 100000, 100000);
    expect(regions).toHaveLength(2);
    expect(regions[0]).toEqual([10, 20, 110, 70]);
  });

  it.each([
    ['inline image', OPS.paintInlineImageXObject],
    ['image mask', OPS.paintImageMaskXObject],
    ['image mask group', OPS.paintImageMaskXObjectGroup],
    ['inline image group', OPS.paintInlineImageXObjectGroup],
    ['image repeat', OPS.paintImageXObjectRepeat],
    ['image mask repeat', OPS.paintImageMaskXObjectRepeat]
  ])('recognizes %s paint operators', (_label, imageOp) => {
    const ops = makeOpList([
      [OPS.transform, [100, 0, 0, 50, 10, 20]],
      [imageOp, ['img_1']]
    ]);

    expect(computeImageRegions(ops, NO_TRANSFORM, 1000, 1000)).toEqual([[10, 20, 110, 70]]);
  });
});
