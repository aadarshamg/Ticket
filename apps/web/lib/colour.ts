const DEFAULT_BRAND = '#4f46e5';

/** The organiser's brand colour, falling back to the default if it is not a #rrggbb value. */
export function brandColour(value: string | null | undefined): string {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : DEFAULT_BRAND;
}

/** Dark or white text, whichever is easier to read on the given #rrggbb background (WCAG luminance). */
export function readableTextOn(hex: string): string {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  // White and near-black text give equal contrast at a luminance of about 0.2.
  return luminance > 0.22 ? '#0f172a' : '#ffffff';
}
