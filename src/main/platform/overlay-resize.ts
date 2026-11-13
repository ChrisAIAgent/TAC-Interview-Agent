import type { Bounds, Point } from './overlay-hit-test';

/** A resize changes bounds only while a primary-button drag is explicitly reported. */
export class OverlayResizeGesture {
  private session: { start: Point; bounds: Bounds; minHeight: number } | null = null;

  begin(point: Point, bounds: Bounds): void {
    this.session = { start: point, bounds, minHeight: bounds.height <= 80 ? 72 : 240 };
  }

  update(point: Point, buttons: number, workArea: Bounds): { width: number; height: number } | null {
    if (!this.session || (buttons & 1) === 0) { this.end(); return null; }
    const { start, bounds, minHeight } = this.session;
    return {
      width: Math.max(380, Math.min(Math.round(bounds.width + point.x - start.x), workArea.x + workArea.width - bounds.x)),
      height: Math.max(minHeight, Math.min(Math.round(bounds.height + point.y - start.y), workArea.y + workArea.height - bounds.y)),
    };
  }

  end(): void { this.session = null; }
}
