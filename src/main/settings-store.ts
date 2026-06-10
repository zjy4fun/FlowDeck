import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface PersistedSettings {
  fontSize: number;
  paneOpacity: number;
  paneWidthRatio: number;
  defaultOpenDirectory: string;
  maxSessions: number;
  themeMode: 'system' | 'light' | 'dark';
  headerMode: 'multi-tab' | 'single-tab';
  developerModeEnabled: boolean;
  aiModeEnabled: boolean;
}

const SETTINGS_FILE = 'settings.json';

const DEFAULTS: PersistedSettings = {
  fontSize: 14,
  paneOpacity: 0.75,
  paneWidthRatio: 0.45,
  defaultOpenDirectory: app.getPath('home'),
  maxSessions: 8,
  themeMode: 'system',
  headerMode: 'multi-tab',
  developerModeEnabled: false,
  aiModeEnabled: false,
};

const LIMITS = {
  fontSize: { min: 10, max: 24 },
  paneOpacity: { min: 0.5, max: 1 },
  paneWidthRatio: { min: 0.22, max: 0.72 },
  maxSessions: { min: 1, max: 9 },
} as const;
const LEGACY_PANE_WIDTH_BASE = 1600;
let settingsDirectoryEnsured = false;
let pendingSave = Promise.resolve();
let latestSettingsForFlush: PersistedSettings | null = null;

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
  const defaultOpenDirectory =
    typeof source.defaultOpenDirectory === 'string' &&
    source.defaultOpenDirectory.trim().length > 0
      ? source.defaultOpenDirectory.trim()
      : DEFAULTS.defaultOpenDirectory;

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
    paneWidthRatio: sanitizeSetting(
      source.paneWidthRatio ??
        (typeof source.paneWidth === 'number'
          ? source.paneWidth / LEGACY_PANE_WIDTH_BASE
          : undefined),
      DEFAULTS.paneWidthRatio,
      LIMITS.paneWidthRatio.min,
      LIMITS.paneWidthRatio.max,
      (v) => Number(v.toFixed(2)),
    ),
    defaultOpenDirectory,
    maxSessions: sanitizeSetting(
      source.maxSessions,
      DEFAULTS.maxSessions,
      LIMITS.maxSessions.min,
      LIMITS.maxSessions.max,
      (v) => Math.round(v),
    ),
    themeMode:
      source.themeMode === 'light' || source.themeMode === 'dark'
        ? source.themeMode
        : 'system',
    headerMode: source.headerMode === 'single-tab' ? 'single-tab' : 'multi-tab',
    developerModeEnabled: source.developerModeEnabled === true,
    aiModeEnabled: source.aiModeEnabled === true,
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

async function ensureSettingsDirectory(filePath: string): Promise<void> {
  if (settingsDirectoryEnsured) return;
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  settingsDirectoryEnsured = true;
}

async function writeSettingsFile(settings: PersistedSettings): Promise<void> {
  const filePath = getSettingsPath();
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await ensureSettingsDirectory(filePath);
  await fs.promises.writeFile(tempPath, JSON.stringify(settings, null, 2));
  await fs.promises.rename(tempPath, filePath);
}

export function saveSettings(settings: PersistedSettings): Promise<void> {
  const sanitized = sanitizePersistedSettings(settings);
  latestSettingsForFlush = sanitized;
  pendingSave = pendingSave
    .then(() => writeSettingsFile(sanitized))
    .catch((err) => {
      console.error('Failed to save settings:', err);
    });
  return pendingSave;
}

export function flushSettingsSync(): void {
  if (!latestSettingsForFlush) return;
  try {
    const filePath = getSettingsPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    settingsDirectoryEnsured = true;
    const tempPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(latestSettingsForFlush, null, 2));
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    console.error('Failed to save settings:', err);
  }
}
