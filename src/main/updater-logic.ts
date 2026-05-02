export type UpdateWindowAction =
  | 'cancel'
  | 'restart'
  | 'close'
  | 'download'
  | 'open-release'
  | 'skip-version';

export interface AvailableUpdatePlanInput {
  manual: boolean;
  skipped: boolean;
  hasHotUpdateAsset: boolean;
  assetInfoIncomplete: boolean;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

export function resolveEffectiveCurrentVersion(
  bundleVersion: string,
  packageVersion: string | null | undefined,
): string {
  const normalizedBundleVersion = bundleVersion.replace(/^v/, '');
  const normalizedPackageVersion = packageVersion?.replace(/^v/, '') ?? '';
  if (!normalizedPackageVersion) return normalizedBundleVersion;
  return compareVersions(normalizedPackageVersion, normalizedBundleVersion) > 0
    ? normalizedPackageVersion
    : normalizedBundleVersion;
}

export type AvailableUpdatePlan =
  | { kind: 'skip' }
  | { kind: 'prompt-download' }
  | { kind: 'prompt-open-release' };

export function resolveAvailableUpdatePlan(
  input: AvailableUpdatePlanInput,
): AvailableUpdatePlan {
  if (!input.manual && input.skipped) {
    return { kind: 'skip' };
  }

  if (!input.hasHotUpdateAsset) {
    return { kind: 'prompt-open-release' };
  }

  return { kind: 'prompt-download' };
}

export function shouldCloseWindowForAction(action: UpdateWindowAction): boolean {
  return action !== 'download';
}
