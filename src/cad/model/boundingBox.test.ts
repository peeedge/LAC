import { describe, expect, it } from 'vitest';
import {
  boundsCenter,
  boundsContainsPoint,
  boundsHeight,
  boundsIntersect,
  boundsWidth,
  createEmptyBounds,
  expandBounds,
  inflateBounds,
  isEmptyBounds,
  normaliseForView,
  unionBounds,
} from './boundingBox';

describe('bounding boxes', () => {
  it('starts empty and reports zero size', () => {
    const bounds = createEmptyBounds();
    expect(isEmptyBounds(bounds)).toBe(true);
    expect(boundsWidth(bounds)).toBe(0);
    expect(boundsHeight(bounds)).toBe(0);
  });

  it('grows to contain added points', () => {
    const bounds = createEmptyBounds();
    expandBounds(bounds, 10, 20);
    expandBounds(bounds, -5, 40);

    expect(bounds).toEqual({ minX: -5, minY: 20, maxX: 10, maxY: 40 });
    expect(boundsWidth(bounds)).toBe(15);
    expect(boundsHeight(bounds)).toBe(20);
    expect(boundsCenter(bounds)).toEqual({ x: 2.5, y: 30 });
  });

  it('ignores non-finite coordinates rather than poisoning the box', () => {
    const bounds = createEmptyBounds();
    expandBounds(bounds, 5, 5);
    expandBounds(bounds, Number.NaN, 100);
    expandBounds(bounds, Number.POSITIVE_INFINITY, 1);

    expect(bounds).toEqual({ minX: 5, minY: 5, maxX: 5, maxY: 5 });
  });

  it('does not assume the drawing starts at the origin', () => {
    // A drawing placed on a survey grid far from (0,0).
    const bounds = createEmptyBounds();
    expandBounds(bounds, 1_500_000, 6_700_000);
    expandBounds(bounds, 1_500_250, 6_700_180);

    expect(boundsWidth(bounds)).toBe(250);
    expect(boundsHeight(bounds)).toBe(180);
    expect(boundsCenter(bounds)).toEqual({ x: 1_500_125, y: 6_700_090 });
  });

  it('unions one box into another', () => {
    const target = createEmptyBounds();
    expandBounds(target, 0, 0);
    unionBounds(target, { minX: -10, minY: 5, maxX: 2, maxY: 30 });

    expect(target).toEqual({ minX: -10, minY: 0, maxX: 2, maxY: 30 });
  });

  it('ignores a union with an empty box', () => {
    const target = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    unionBounds(target, createEmptyBounds());
    expect(target).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
  });

  it('inflates and tests intersection and containment', () => {
    const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

    expect(inflateBounds(bounds, 2)).toEqual({ minX: -2, minY: -2, maxX: 12, maxY: 12 });
    expect(boundsIntersect(bounds, { minX: 9, minY: 9, maxX: 20, maxY: 20 })).toBe(true);
    expect(boundsIntersect(bounds, { minX: 11, minY: 0, maxX: 20, maxY: 10 })).toBe(false);
    expect(boundsContainsPoint(bounds, 5, 5)).toBe(true);
    expect(boundsContainsPoint(bounds, 15, 5)).toBe(false);
  });

  describe('normaliseForView', () => {
    it('substitutes a default box for empty bounds', () => {
      const result = normaliseForView(createEmptyBounds(), 100);
      expect(result).toEqual({ minX: -50, minY: -50, maxX: 50, maxY: 50 });
    });

    it('pads a horizontal line so the height is non-zero', () => {
      // Without padding this would produce an infinite zoom factor.
      const result = normaliseForView({ minX: 0, minY: 5, maxX: 100, maxY: 5 });
      expect(boundsWidth(result)).toBe(100);
      expect(boundsHeight(result)).toBe(100);
      expect(boundsCenter(result)).toEqual({ x: 50, y: 5 });
    });

    it('pads a single point into a square', () => {
      const result = normaliseForView({ minX: 7, minY: 7, maxX: 7, maxY: 7 }, 20);
      expect(boundsWidth(result)).toBe(20);
      expect(boundsHeight(result)).toBe(20);
    });

    it('leaves a well-formed box untouched', () => {
      const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 20 };
      expect(normaliseForView(bounds)).toEqual(bounds);
    });
  });
});
