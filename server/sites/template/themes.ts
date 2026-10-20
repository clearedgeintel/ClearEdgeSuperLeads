import type { Theme } from "@shared/sites";

// Visual design tokens for the three site themes (spec §6). Accent color is
// supplied per-site by `data.brandColor`; everything else comes from the theme.
export interface ThemeTokens {
  name: string;
  // Google Fonts families to load + CSS font stacks.
  fontHeadingName: string;
  fontBodyName: string;
  fontHeading: string;
  fontBody: string;
  // Surfaces / text.
  pageBg: string;
  headerBg: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  muted: string;
  border: string;
  // Hero.
  heroBg: string; // may reference --accent
  heroText: string;
  heroMuted: string;
  // Footer.
  footerBg: string;
  footerText: string;
  // Whether the base palette is dark (affects accent tints).
  dark: boolean;
}

export const THEMES: Record<Theme, ThemeTokens> = {
  // Dark / bold — default for trades.
  slate: {
    name: "Slate",
    fontHeadingName: "Sora:wght@600;700;800",
    fontBodyName: "Inter:wght@400;500;600",
    fontHeading: "'Sora', system-ui, sans-serif",
    fontBody: "'Inter', system-ui, sans-serif",
    pageBg: "#0f172a",
    headerBg: "rgba(15,23,42,0.85)",
    surface: "#1e293b",
    surfaceAlt: "#172033",
    text: "#f1f5f9",
    muted: "#94a3b8",
    border: "#334155",
    heroBg:
      "radial-gradient(1200px 600px at 70% -10%, color-mix(in srgb, var(--accent) 35%, transparent), transparent), linear-gradient(180deg, #0b1222 0%, #0f172a 100%)",
    heroText: "#f8fafc",
    heroMuted: "#cbd5e1",
    footerBg: "#0b1222",
    footerText: "#94a3b8",
    dark: true,
  },
  // Light / professional — default for property management.
  clean: {
    name: "Clean",
    fontHeadingName: "Manrope:wght@600;700;800",
    fontBodyName: "Inter:wght@400;500;600",
    fontHeading: "'Manrope', system-ui, sans-serif",
    fontBody: "'Inter', system-ui, sans-serif",
    pageBg: "#ffffff",
    headerBg: "rgba(255,255,255,0.9)",
    surface: "#ffffff",
    surfaceAlt: "#f8fafc",
    text: "#0f172a",
    muted: "#64748b",
    border: "#e2e8f0",
    heroBg:
      "linear-gradient(180deg, color-mix(in srgb, var(--accent) 10%, #ffffff) 0%, #ffffff 100%)",
    heroText: "#0f172a",
    heroMuted: "#475569",
    footerBg: "#0f172a",
    footerText: "#94a3b8",
    dark: false,
  },
  // Friendly / warm.
  warm: {
    name: "Warm",
    fontHeadingName: "Poppins:wght@600;700;800",
    fontBodyName: "Nunito+Sans:wght@400;500;600",
    fontHeading: "'Poppins', system-ui, sans-serif",
    fontBody: "'Nunito Sans', system-ui, sans-serif",
    pageBg: "#fffaf5",
    headerBg: "rgba(255,250,245,0.9)",
    surface: "#ffffff",
    surfaceAlt: "#fdf3e9",
    text: "#292524",
    muted: "#78716c",
    border: "#f0e2d2",
    heroBg:
      "linear-gradient(180deg, color-mix(in srgb, var(--accent) 16%, #fffaf5) 0%, #fffaf5 100%)",
    heroText: "#1c1917",
    heroMuted: "#57534e",
    footerBg: "#1c1917",
    footerText: "#a8a29e",
    dark: false,
  },
};

/**
 * Auto-pick the default theme from the business category (spec §6):
 * trades → slate, property/realty → clean, else → warm.
 */
export function defaultThemeForCategory(category: string): Theme {
  const c = (category || "").toLowerCase();
  const trades = /(roof|hvac|plumb|electric|construction|contractor|landscap|paint|remodel|concrete|fenc|garage|gutter|pest|clean|restoration|septic|solar|paving|tree|excavat|mason|drywall|window|insulat)/;
  const property = /(property|realty|real estate|realtor|apartment|leasing|rental|hoa|management)/;
  if (property.test(c)) return "clean";
  if (trades.test(c)) return "slate";
  return "warm";
}

/** Validate/sanitize a hex color (prevents CSS injection via brandColor). */
export function sanitizeHex(input: string, fallback = "#2563eb"): string {
  const m = (input || "").trim().match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!m) return fallback;
  return "#" + m[1];
}

/** Pick a readable text color (near-white or near-black) for text on the accent. */
export function onAccentText(hex: string): string {
  const c = sanitizeHex(hex);
  let r: number, g: number, b: number;
  if (c.length === 4) {
    r = parseInt(c[1] + c[1], 16);
    g = parseInt(c[2] + c[2], 16);
    b = parseInt(c[3] + c[3], 16);
  } else {
    r = parseInt(c.slice(1, 3), 16);
    g = parseInt(c.slice(3, 5), 16);
    b = parseInt(c.slice(5, 7), 16);
  }
  // Relative luminance (sRGB approximation).
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#0b0b0b" : "#ffffff";
}
