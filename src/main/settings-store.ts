import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface PersistedSettings {
  fontSize: number;
  paneOpacity: number;
  paneWidth: number;
}

const SETTINGS_FILE = 'settings.json';

const DEFAULTS: PersistedSettings = {
  fontSize: 13,
  paneOpacity: 0.8,
  paneWidth: 720,
};

const LIMITS = {
  fontSize: { min: 10, max: 24 },
  paneOpacity: { min: 0.55, max: 1 },
  paneWidth: { min: 520, max: 1000 },
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeSetting(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  normalize: (value: number) => number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return clamp(normalize(value), min, max);
}

function sanitizePersistedSettings(parsed: unknown): PersistedSettings {
  const source = isRecord(parsed) ? parsed : {};

  return {
    fontSize: sanitizeSetting(
      source.fontSize,
      DEFAULTS.fontSize,
      LIMITS.fontSize.min,
      LIMITS.fontSize.max,
      (v) => Math.round(v),
    ),
    paneOpacity: sanitizeSetting(
      source.paneOpacity,
      DEFAULTS.paneOpacity,
      LIMITS.paneOpacity.min,
      LIMITS.paneOpacity.max,
      (v) => Number(v.toFixed(2)),
    ),
    paneWidth: sanitizeSetting(
      source.paneWidth,
      DEFAULTS.paneWidth,
      LIMITS.paneWidth.min,
      LIMITS.paneWidth.max,
      (v) => Math.round(v / 10) * 10,
    ),
  };
}

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), SETTINGS_FILE);
}

export function loadSettings(): PersistedSettings {
  try {
    const raw = fs.readFileSync(getSettingsPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return sanitizePersistedSettings(parsed);
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: PersistedSettings): void {
  try {
    const filePath = getSettingsPath();
    const sanitized = sanitizePersistedSettings(settings);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(sanitized, null, 2));
  } catch (err) {
    console.error('Failed to save settings:', err);
  }
}
