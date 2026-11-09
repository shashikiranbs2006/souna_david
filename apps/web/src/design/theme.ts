import { contrast, oklchToHex, parseHex, rgbToOklch, type Oklch } from './color.ts';

/**
 * Unary design tokens: a white page, near-neutral ink and greys that carry only
 * a trace of the brand hue, and the brand hue itself (in tints and shades) as
 * the single accent for actions, links, selection and small highlights. There
 * is no second accent colour; changing the one brand colour re-themes everything.
 *
 *   --ink        body text and rules that need weight (near-black); never a fill
 *   --primary    primary actions, links and selection (brand hue, AA against its
 *                label and the page); --primary-hover, --on-primary its label
 *   --accent     the brand hue at mid lightness (dots, stop marks, italics)
 *   --accent-soft a pale tint of the brand hue for small badges and markers
 *   --highlight  a quiet brand-tinted wash for selected/hovered rows (ink on it)
 *   --surface    alias of --card for raised panels; --frame behind photographs
 *   --ink-2..6   lightness steps from ink towards paper (2 = strongest)
 *   --paper      page background (white); --paper-2/3 quiet bands and pressed surfaces
 *   --card       pure white (cards, dialogs, inputs)
 *   --line       hairlines; --line-strong for inputs
 *   --on-ink     text on an ink surface
 *   --focus      focus ring
 *   --brand      the reseller's colour exactly as configured
 *   --night*     the footer band and photo scrims: stays dark in both modes
 */
/** Platform and shop default: a deep ember copper, the colour of oiled wood and stove glow. */
export const DEFAULT_PRIMARY = '#9a4a24';

export type ThemeTokens = Record<`--${string}`, string>;

/**
 * How a storefront layout bends the derivation: `warm` pulls the surfaces
 * towards wood and paper (nordic), `dark` serves the dark set in both modes
 * (showroom). The ink, contrast targets and accent stay the hue's own.
 */
export type ThemeFlavour = 'default' | 'warm' | 'dark';

export interface Theme {
  light: ThemeTokens;
  dark: ThemeTokens;
  /** `dark`: the dark tokens apply in both colour schemes. */
  scheme: 'auto' | 'dark';
  /** Colour for `<meta name="theme-color">` and the 3D viewer background. */
  metaLight: string;
  metaDark: string;
}

/** Chroma for a step: the hue's own chroma scaled, then capped (surfaces stay quiet). */
const k = (c0: number, f: number, cap: number) => Math.min(c0 * f, cap);

export function deriveTheme(primaryHex: string, flavour: ThemeFlavour = 'default'): Theme {
  const rgb = parseHex(primaryHex) ?? parseHex(DEFAULT_PRIMARY)!;
  const base = rgbToOklch(rgb);
  // Achromatic input has an undefined hue; pin it to slate so the tint stays cool and faint.
  const neutral = base.c < 0.002;
  const hue = neutral ? 250 : base.h;
  const c0 = neutral ? 0.012 : Math.min(base.c, 0.2);
  const c = (l: number, ch: number): string => oklchToHex({ l, c: ch, h: hue });
  // Warm: surfaces take a wood hue (≈75°) with a touch more chroma: a warm white, never a tint
  // that passes through green on its way from a cool brand hue.
  const warm = flavour === 'warm';
  const woodHue = 75;
  const sc = warm ? 0.003 : 0;
  const surf = (l: number, ch: number): string => (warm ? oklchToHex({ l, c: ch + sc, h: woodHue }) : c(l, ch));

  // Text steps are pulled towards ink (lightness only) until they clear their
  // contrast target on every given surface (pages, quiet bands, highlight washes).
  const fit = (l: number, ch: number, towards: number, surfaces: string[], min: number) => {
    let ll = l;
    let hex = c(ll, ch);
    while (surfaces.some(sf => contrast(hex, sf) < min) && Math.abs(ll - towards) > 0.005) {
      ll += Math.sign(towards - ll) * 0.005;
      hex = c(ll, ch);
    }
    return hex;
  };
  // The accent at mid lightness: the brand itself where it sits in a usable band.
  const accentL = Math.min(0.62, Math.max(0.46, base.l));

  // ---- light ----------------------------------------------------------------
  // A white page; greys keep only a trace of the hue so the accent stays the one colour.
  const lp = surf(0.995, k(c0, 0.04, 0.003));
  const lp2 = surf(0.977, k(c0, 0.08, 0.0045));
  const lp3 = surf(0.956, k(c0, 0.1, 0.007));
  const lhl = c(0.958, k(c0, 0.2, 0.022));
  const light: ThemeTokens = {
    '--ink': c(0.2, k(c0, 0.16, 0.014)),
    '--ink-2': fit(0.33, k(c0, 0.18, 0.016), 0.2, [lp, lp2], 8),
    '--ink-3': fit(0.5, k(c0, 0.2, 0.018), 0.2, [lp2, lp3, lhl], 4.9),
    '--ink-4': c(0.66, k(c0, 0.2, 0.016)),
    '--ink-5': c(0.8, k(c0, 0.16, 0.0095)),
    '--ink-6': c(0.915, k(c0, 0.12, 0.01)),
    '--paper': lp,
    '--paper-2': lp2,
    '--paper-3': lp3,
    '--card': '#ffffff',
    '--line': surf(0.918, k(c0, 0.12, 0.009)),
    '--line-strong': surf(0.84, k(c0, 0.15, 0.0095)),
    '--on-ink': lp,
    '--focus': c(0.6, k(c0, 0.8, 0.05)),
    '--accent': c(accentL, k(c0, 1, 0.14)),
    '--accent-soft': c(0.94, k(c0, 0.3, 0.035)),
    '--night': c(0.19, k(c0, 0.18, 0.016)),
    '--night-2': c(0.245, k(c0, 0.2, 0.018)),
    '--on-night': c(0.975, k(c0, 0.06, 0.005)),
    '--night-muted': c(0.74, k(c0, 0.2, 0.016)),
    '--night-line': c(0.32, k(c0, 0.2, 0.016)),
  };
  // Light text on the brand fill (the visit card, the footer accent dot) stays legible.
  light['--accent-on-night'] = c(Math.max(0.68, accentL), k(c0, 0.9, 0.13));

  // ---- dark -----------------------------------------------------------------
  const dp = surf(flavour === 'dark' ? 0.15 : 0.175, k(c0, 0.5, 0.018));
  const dp2 = surf(flavour === 'dark' ? 0.19 : 0.21, k(c0, 0.55, 0.02));
  const dark: ThemeTokens = {
    '--ink': c(0.955, k(c0, 0.2, 0.012)),
    '--ink-2': fit(0.86, k(c0, 0.3, 0.02), 0.955, [dp], 7),
    '--ink-3': fit(0.74, k(c0, 0.5, 0.03), 0.955, [dp2, surf(0.27, k(c0, 0.6, 0.035))], 5.05),
    '--ink-4': c(0.6, k(c0, 0.6, 0.035)),
    '--ink-5': c(0.43, k(c0, 0.6, 0.03)),
    '--ink-6': c(0.3, k(c0, 0.55, 0.025)),
    '--paper': dp,
    '--paper-2': dp2,
    '--paper-3': surf(0.25, k(c0, 0.55, 0.022)),
    '--card': surf(flavour === 'dark' ? 0.2 : 0.225, k(c0, 0.55, 0.02)),
    '--line': surf(0.31, k(c0, 0.55, 0.022)),
    '--line-strong': c(0.44, k(c0, 0.6, 0.03)),
    '--on-ink': dp,
    '--focus': c(0.7, k(c0, 0.6, 0.04)),
    '--accent': c(0.68, k(c0, 0.9, 0.1)),
    '--accent-soft': c(0.3, k(c0, 0.5, 0.05)),
    '--accent-on-night': c(0.72, k(c0, 0.9, 0.12)),
    '--night': c(0.13, k(c0, 0.5, 0.02)),
    '--night-2': c(0.2, k(c0, 0.55, 0.022)),
    '--on-night': c(0.955, k(c0, 0.2, 0.012)),
    '--night-muted': c(0.68, k(c0, 0.6, 0.035)),
    '--night-line': c(0.27, k(c0, 0.55, 0.022)),
  };

  const brand = oklchToHex(neutral ? { ...base, h: hue } : base);
  light['--brand'] = brand;
  dark['--brand'] = brand;

  // ---- semantic action tokens ----------------------------------------------
  // The primary action is the brand colour itself where it can carry its label;
  // otherwise it moves along lightness only (hue and chroma kept, gamut allowing)
  // until the label clears 4.5:1. Its label is the page colour, so the fill also
  // stands at least 4.5:1 off the page (3:1 is the UI minimum).
  const pc = neutral ? 0.03 : base.c;
  const pick = (startL: number, dir: 1 | -1, label: string) => {
    let l = startL;
    let hex = oklchToHex({ l, c: pc, h: hue });
    while (contrast(hex, label) < 4.6 && l > 0.02 && l < 0.98) {
      l += dir * 0.01;
      hex = oklchToHex({ l, c: pc, h: hue });
    }
    return { l, hex };
  };
  const semantic = (t: ThemeTokens, mode: 'light' | 'dark') => {
    const page = t['--paper']!;
    const dir = mode === 'light' ? -1 : 1;
    const p = pick(mode === 'light' ? Math.min(base.l, 0.9) : Math.max(base.l, 0.5), dir, page);
    t['--primary'] = p.hex;
    t['--primary-hover'] = oklchToHex({ l: Math.min(0.97, Math.max(0.03, p.l + dir * 0.06)), c: pc, h: hue });
    t['--on-primary'] = page;
    // Selected/hover wash behind ink text (rows, chips, chosen options).
    t['--highlight'] = mode === 'light' ? lhl : surf(0.27, k(c0, 0.6, 0.035));
    t['--surface'] = t['--card']!;
    // Neutral backdrop behind photographs (beige-floor exteriors, bright wood interiors).
    t['--frame'] = mode === 'light' ? oklchToHex({ l: 0.94, c: 0.006, h: hue }) : oklchToHex({ l: 0.24, c: 0.008, h: hue });
    t['--focus'] = p.hex;
  };
  semantic(light, 'light');
  semantic(dark, 'dark');

  if (flavour === 'dark') return { light: dark, dark, scheme: 'dark', metaLight: dark['--paper']!, metaDark: dark['--paper']! };
  return { light, dark, scheme: 'auto', metaLight: light['--paper']!, metaDark: dark['--paper']! };
}

const block = (tokens: ThemeTokens) => Object.entries(tokens).map(([k, v]) => `  ${k}: ${v};`).join('\n');

/** CSS for a `<style>` element: light on :root, dark under prefers-color-scheme. */
export function themeCss(theme: Theme): string {
  if (theme.scheme === 'dark') return `:root {\n${block(theme.dark)}\n  color-scheme: dark;\n}\n`;
  return `:root {\n${block(theme.light)}\n  color-scheme: light dark;\n}\n@media (prefers-color-scheme: dark) {\n  :root {\n${block(theme.dark)}\n  }\n}\n`;
}

/** Installs (or replaces) the tenant theme on the document. */
export function applyTheme(primaryHex: string | null | undefined, flavour: ThemeFlavour = 'default'): Theme {
  const theme = deriveTheme(primaryHex || DEFAULT_PRIMARY, flavour);
  if (typeof document === 'undefined') return theme;
  let el = document.getElementById('tenant-theme') as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = 'tenant-theme';
    document.head.appendChild(el);
  }
  el.textContent = themeCss(theme);
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? theme.metaDark : theme.metaLight);
  return theme;
}

/** For tests and admin previews: does the derived pair keep body text readable? */
export function inkOnPaperContrast(theme: Theme, mode: 'light' | 'dark' = 'light'): number {
  const t = mode === 'light' ? theme.light : theme.dark;
  return contrast(t['--ink']!, t['--paper']!);
}

export type { Oklch };
