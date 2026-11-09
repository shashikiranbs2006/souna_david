const DEFAULT_INK = '#141414';

/** Accepts `#rrggbb` only; anything else (including CSS injection attempts) falls back to ink. */
export function normaliseColor(value: string | undefined): string {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : DEFAULT_INK;
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** Mixes the colour with white: `amount` 0 keeps it, 1 is white. Used for tints of the one hue. */
export function tint(hex: string, amount: number): string {
  const mix = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16);
    return Math.round(c + (255 - c) * amount)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${mix(1)}${mix(3)}${mix(5)}`;
}

/** Mixes the colour with black. */
export function shade(hex: string, amount: number): string {
  const mix = (i: number) =>
    Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - amount))
      .toString(16)
      .padStart(2, '0');
  return `#${mix(1)}${mix(3)}${mix(5)}`;
}

/** Mixes two colours: `amount` 0 keeps `a`, 1 is `b`. */
function mix(a: string, b: string, amount: number): string {
  const ch = (i: number) =>
    Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - amount) + parseInt(b.slice(i, i + 2), 16) * amount)
      .toString(16)
      .padStart(2, '0');
  return `#${ch(1)}${ch(3)}${ch(5)}`;
}

/**
 * The palette of a single-colour mail, matching the web app: white paper on a warm-white
 * canvas, near-neutral ink and greys that carry only a trace of the brand hue, and the brand
 * colour itself (darkened where it is too light to read) as the one accent for the button,
 * links and the thin top rule.
 */
export function palette(primary: string | undefined) {
  const brand = normaliseColor(primary);
  const lum = luminance(brand);
  // Darken light brand colours until text on paper reaches roughly 4.5:1.
  const accent = lum > 0.18 ? shade(brand, lum > 0.5 ? 0.75 : 0.55) : brand;
  // Neutral greys with a trace of the hue (about 8 % of it).
  const ink = mix('#1a1a1a', shade(accent, 0.6), 0.25);
  return {
    accent,
    ink,
    onAccent: '#ffffff',
    paper: '#ffffff',
    canvas: mix('#faf9f8', tint(accent, 0.9), 0.25),
    rule: mix('#e8e6e4', tint(accent, 0.8), 0.15),
    muted: mix('#6b6866', accent, 0.08),
  };
}
