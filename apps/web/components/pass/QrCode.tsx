import QRCode from 'qrcode';

const QUIET_ZONE = 4; // modules of white border the QR standard asks for

/**
 * Renders a QR code on the server as an SVG image inside the page HTML: no image request,
 * sharp at any size, and still there when the page is opened offline.
 *
 * It is an <img> with a data: URL rather than inline SVG on purpose: phone browsers that force
 * dark mode on websites (Samsung Internet, Chrome's auto-dark) recolour inline SVG, which turns
 * the code grey on dark grey and hard for the gate camera to read, but leave images alone.
 */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { size, data } = QRCode.create(value, { errorCorrectionLevel: 'M' }).modules;

  // One rectangle per horizontal run of dark modules.
  let path = '';
  for (let y = 0; y < size; y++) {
    let x = 0;
    while (x < size) {
      if (!data[y * size + x]) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < size && data[y * size + x + run]) run++;
      path += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h${run}v1h-${run}z`;
      x += run;
    }
  }

  const total = size + QUIET_ZONE * 2;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="#ffffff"/><path d="${path}" fill="#000000"/></svg>`;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- an inline data: image, nothing to optimise
    <img
      src={`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`}
      alt={label}
      className="block h-full w-full bg-white [image-rendering:pixelated]"
      draggable={false}
    />
  );
}
