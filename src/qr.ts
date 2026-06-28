/**
 * Tiny QR → SVG renderer.
 *
 * Reuses the QR encoder already vendored inside `qrcode-terminal` (a direct
 * dependency, used by the WhatsApp bridge) so generating a pairing code doesn't
 * pull in a new package. The output is a self-contained SVG string (no external
 * refs, no <script>) — safe to inline under the dashboard's strict CSP.
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

interface QRCodeModel {
  addData(data: string): void;
  make(): void;
  getModuleCount(): number;
  isDark(row: number, col: number): boolean;
}
type QRCodeCtor = new (typeNumber: number, errorCorrectLevel: number) => QRCodeModel;

// Deep import into qrcode-terminal's bundled encoder — the package has no public
// ESM entry for the constructor, only the terminal renderer. Pinned via lockfile.
const QRCode = require('qrcode-terminal/vendor/QRCode') as QRCodeCtor;
const QRErrorCorrectLevel = require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel') as Record<string, number>;

export interface QrSvgOptions {
  /** Quiet-zone width in modules (QR spec minimum is 4). */
  margin?: number;
  /** Rendered pixel size of the square SVG. */
  size?: number;
}

/** Encode `text` into a QR code and return it as an inline SVG string. */
export function qrSvg(text: string, opts: QrSvgOptions = {}): string {
  const margin = opts.margin ?? 4;
  const size = opts.size ?? 256;

  // typeNumber -1 => auto-size to the data; M = ~15% error correction.
  const qr = new QRCode(-1, QRErrorCorrectLevel.M);
  qr.addData(text);
  qr.make();

  const count = qr.getModuleCount();
  const dim = count + margin * 2;

  let rects = '';
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) {
        rects += `<rect x="${col + margin}" y="${row + margin}" width="1" height="1"/>`;
      }
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" role="img" aria-label="QR code">` +
    `<rect width="${dim}" height="${dim}" fill="#ffffff"/>` +
    `<g fill="#000000">${rects}</g>` +
    `</svg>`
  );
}
