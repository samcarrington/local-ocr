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
  'paintSolidColorImageMask',
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
    ['solid color image mask', OPS.paintSolidColorImageMask]
  ])('recognizes %s paint operators', (_label, imageOp) => {
    const ops = makeOpList([
      [OPS.transform, [100, 0, 0, 50, 10, 20]],
      [imageOp, ['img_1']]
    ]);

    expect(computeImageRegions(ops, NO_TRANSFORM, 1000, 1000)).toEqual([[10, 20, 110, 70]]);
  });

  it('expands inline image groups from each map transform and atlas rectangle', () => {
    const ops = makeOpList([
      [OPS.transform, [999, 0, 0, 999, 999, 999]],
      [
        OPS.paintInlineImageXObjectGroup,
        [
          { width: 400, height: 300 },
          [
            { transform: [2, 0, 0, 2, 10, 20], x: 5, y: 10, w: 50, h: 40 },
            { transform: [1, 0, 0, 1, 200, 100], x: 0, y: 0, w: 80, h: 60 }
          ]
        ]
      ]
    ]);

    expect(computeImageRegions(ops, NO_TRANSFORM, 1000, 1000)).toEqual([
      [20, 40, 120, 120],
      [200, 100, 280, 160]
    ]);
  });

  it('expands image mask groups from each item transform and dimensions', () => {
    const ops = makeOpList([
      [
        OPS.paintImageMaskXObjectGroup,
        [
          [
            { transform: [1, 0, 0, 1, 10, 20], width: 100, height: 50 },
            { transform: [2, 0, 0, 2, 200, 100], img: { width: 40, height: 30 } }
          ]
        ]
      ]
    ]);

    expect(computeImageRegions(ops, NO_TRANSFORM, 1000, 1000)).toEqual([
      [10, 20, 110, 70],
      [200, 100, 280, 160]
    ]);
  });

  it('expands repeated image xobjects from scale and positions', () => {
    const ops = makeOpList([
      [OPS.transform, [999, 0, 0, 999, 999, 999]],
      [OPS.paintImageXObjectRepeat, ['img_1', 100, 50, [10, 20, 200, 100]]]
    ]);

    expect(computeImageRegions(ops, NO_TRANSFORM, 1000, 1000)).toEqual([
      [10, 20, 110, 70],
      [200, 100, 300, 150]
    ]);
  });

  it('expands repeated image masks from full transform matrix and positions', () => {
    const ops = makeOpList([
      [OPS.paintImageMaskXObjectRepeat, [{ width: 1, height: 1 }, 100, 10, 20, 50, [10, 20, 200, 100]]]
    ]);

    expect(computeImageRegions(ops, NO_TRANSFORM, 1000, 1000)).toEqual([
      [10, 20, 130, 80],
      [200, 100, 320, 160]
    ]);
  });
});
