/**
 * Saves the original drawing bytes through the browser's download mechanism.
 *
 * LiteCAD currently has no editing model and LibreDWG does not expose a DWG
 * writer, so preserving the source file is the only lossless DWG save path.
 */
export function saveDrawingCopy(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');

  link.href = url;
  link.download = file.name;
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();

  // Keep the object URL alive until the browser has begun consuming it.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
