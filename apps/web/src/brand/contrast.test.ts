import { describe, expect, it } from 'vitest';
import { createAppTheme } from '../theme';
import { COLORWAY_CHOICES, colorways } from './tokens';

function channel(hex: string, start: number): number {
  const value = parseInt(hex.slice(start, start + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

describe('desk contrast and type', () => {
  it('keeps text, muted, accent, and status colors at WCAG AA in every colorway', () => {
    for (const choice of COLORWAY_CHOICES) {
      for (const mode of ['light', 'dark'] as const) {
        const color = colorways[choice.id][mode];
        const pairs: Array<[string, string, string]> = [
          ['text on background', color.text, color.background],
          ['text on surface', color.text, color.surface],
          ['muted on background', color.muted, color.background],
          ['muted on surface', color.muted, color.surface],
          ['accent on background', color.emerald, color.background],
          ['accent on surface', color.emerald, color.surface],
          ['secondary accent on background', color.cyan, color.background],
          ['secondary accent on surface', color.cyan, color.surface],
          ['button text on accent', color.onPrimary, color.emerald],
          ['positive on background', color.positive, color.background],
          ['positive on surface', color.positive, color.surface],
          ['warning on background', color.warning, color.background],
          ['warning on surface', color.warning, color.surface],
          ['negative on background', color.negative, color.background],
          ['negative on surface', color.negative, color.surface],
        ];
        for (const [name, foreground, background] of pairs) {
          expect(contrast(foreground, background), `${choice.id} ${mode} ${name}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('keeps the same type scale when only the colorway changes', () => {
    const base = createAppTheme('dark', 'default');
    for (const choice of COLORWAY_CHOICES) {
      for (const mode of ['light', 'dark'] as const) {
        const theme = createAppTheme(mode, choice.id);
        expect(theme.typography.fontSize).toBe(base.typography.fontSize);
        expect(theme.typography.fontFamily).toBe(base.typography.fontFamily);
        expect(theme.typography.h4).toMatchObject({ fontSize: base.typography.h4.fontSize, fontFamily: base.typography.h4.fontFamily });
        expect(theme.typography.body1).toMatchObject({ fontSize: base.typography.body1.fontSize, lineHeight: base.typography.body1.lineHeight });
        expect(theme.typography.body2.fontSize).toBe(base.typography.body2.fontSize);
        expect(theme.typography.caption.fontSize).toBe(base.typography.caption.fontSize);
      }
    }
  });
});
