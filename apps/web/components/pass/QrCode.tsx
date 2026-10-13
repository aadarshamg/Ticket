import QRCode from 'qrcode';

const QUIET_ZONE = 4; // modules of white border the QR standard asks for

/**
 * Renders a QR code as inline SVG on the server, so it is part of the page HTML:
 * no image request, sharp at any size, and still there when the page is opened offline.
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
  return (
    <svg
      viewBox={`0 0 ${total} ${total}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className="block h-full w-full"
    >
      <rect width={total} height={total} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
