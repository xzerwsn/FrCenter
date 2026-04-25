export type SiteTheme = {
  id: string;
  name: string;
  background: string;
  surface: string;
  text: string;
  accent: string;
  secondaryAccent: string;
  swatches: string[];
};

export const THEME_STORAGE_KEY = "frcenter.siteTheme";

export const SITE_THEMES: SiteTheme[] = [
  {
    id: "classic-dark",
    name: "Тёмная",
    background: "#0F1722",
    surface: "#1A2431",
    text: "#F3F7FB",
    accent: "#4C8DFF",
    secondaryAccent: "#8EC5FF",
    swatches: ["#0F1722", "#1A2431", "#F3F7FB", "#4C8DFF", "#8EC5FF"],
  },
  {
    id: "classic-light",
    name: "Светлая",
    background: "#F4F7FB",
    surface: "#FFFFFF",
    text: "#18212B",
    accent: "#3E79F7",
    secondaryAccent: "#87B4FF",
    swatches: ["#F4F7FB", "#FFFFFF", "#18212B", "#3E79F7", "#87B4FF"],
  },
  {
    id: "ashes",
    name: "Пепел",
    background: "#0A0A0A",
    surface: "#33312F",
    text: "#B7B4AE",
    accent: "#726E68",
    secondaryAccent: "#371E1E",
    swatches: ["#B7B4AE", "#726E68", "#33312F", "#371E1E", "#0A0A0A"],
  },
  {
    id: "northern-lights",
    name: "Северное сияние",
    background: "#1F0922",
    surface: "#4B2B55",
    text: "#CAD5D4",
    accent: "#89B199",
    secondaryAccent: "#6F7074",
    swatches: ["#1F0922", "#4B2B55", "#6F7074", "#89B199", "#CAD5D4"],
  },
  {
    id: "dawn",
    name: "Рассвет",
    background: "#CA2851",
    surface: "#FF6766",
    text: "#FFE3B3",
    accent: "#FFB173",
    secondaryAccent: "#FFE3B3",
    swatches: ["#CA2851", "#FF6766", "#FFB173", "#FFE3B3"],
  },
];

export function loadStoredThemeId(): string {
  const fallback = SITE_THEMES[0].id;
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (!saved) {
      return fallback;
    }
    return SITE_THEMES.some((theme) => theme.id === saved) ? saved : fallback;
  } catch {
    return fallback;
  }
}

export function persistThemeId(themeId: string): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, themeId);
  } catch {
    // ignore storage write errors
  }
}

export function applyTheme(theme: SiteTheme): void {
  if (typeof document === "undefined") {
    return;
  }
  const vars = buildThemeVars(theme);
  const root = document.documentElement;
  Object.entries(vars).forEach(([name, value]) => {
    root.style.setProperty(name, value);
  });
}

function buildThemeVars(theme: SiteTheme): Record<string, string> {
  return {
    "--color-bg": theme.background,
    "--color-surface": theme.surface,
    "--color-text": theme.text,
    "--color-accent": theme.accent,
    "--color-accent-2": theme.secondaryAccent,
    "--color-surface-strong": mixHex(theme.surface, theme.background, 0.44),
    "--color-surface-deep": mixHex(theme.surface, "#000000", 0.42),
    "--color-input": mixHex(theme.surface, "#000000", 0.2),
    "--color-text-muted": mixHex(theme.text, theme.surface, 0.34),
    "--color-button-text": pickReadableText(theme.accent),
    "--color-border": theme.secondaryAccent,
    "--color-accent-hover": mixHex(theme.secondaryAccent, "#000000", 0.16),
  };
}

function pickReadableText(backgroundHex: string): string {
  const rgb = hexToRgb(backgroundHex);
  if (!rgb) {
    return "#0F0F0F";
  }
  const luma = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return luma > 0.55 ? "#111111" : "#F8F8F8";
}

function mixHex(firstHex: string, secondHex: string, ratio: number): string {
  const first = hexToRgb(firstHex);
  const second = hexToRgb(secondHex);
  if (!first || !second) {
    return firstHex;
  }
  const safeRatio = Math.max(0, Math.min(1, ratio));
  return rgbToHex({
    r: Math.round(first.r * (1 - safeRatio) + second.r * safeRatio),
    g: Math.round(first.g * (1 - safeRatio) + second.g * safeRatio),
    b: Math.round(first.b * (1 - safeRatio) + second.b * safeRatio),
  });
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return null;
  }
  const value = Number.parseInt(normalized, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function rgbToHex(rgb: { r: number; g: number; b: number }): string {
  const clamp = (value: number) => Math.max(0, Math.min(255, value));
  const toHex = (value: number) => clamp(value).toString(16).padStart(2, "0");
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}
