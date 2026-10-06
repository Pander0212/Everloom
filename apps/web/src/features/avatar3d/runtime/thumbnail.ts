/** A square picture of the stage as it is now (for avatar thumbnails). */
import type { Stage3D } from './stage';

export function captureThumbnail(stage: Stage3D, size = 384): Promise<Blob> {
  // Render now and read the canvas in the same task (the drawing buffer isn't kept otherwise).
  stage.renderer.render(stage.scene, stage.camera);
  const src = stage.canvas;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const s = Math.min(src.width, src.height);
  // The top-centre square: faces and upper bodies, not feet.
  g.drawImage(src, (src.width - s) / 2, Math.max(0, (src.height - s) * 0.15), s, s, 0, 0, size, size);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be taken'))), 'image/png'));
}
