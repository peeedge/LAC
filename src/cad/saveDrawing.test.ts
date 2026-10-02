/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveDrawingCopy } from './saveDrawing';

describe('saveDrawingCopy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('downloads the original DWG with its original file name', () => {
    vi.useFakeTimers();
    const file = new File([new Uint8Array([0x41, 0x43, 0x31, 0x30, 0x33, 0x32])], 'plan.dwg');
    const createObjectURL = vi.fn(() => 'blob:litecad-test');
    const revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    saveDrawingCopy(file);

    const link = click.mock.instances[0] as HTMLAnchorElement;
    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(link.download).toBe('plan.dwg');
    expect(link.href).toBe('blob:litecad-test');
    expect(link.isConnected).toBe(false);

    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:litecad-test');
  });
});
