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

  if (!input.hasHotUpdateAsset || input.assetInfoIncomplete) {
    return { kind: 'prompt-open-release' };
  }

  return { kind: 'prompt-download' };
}

export function shouldCloseWindowForAction(action: UpdateWindowAction): boolean {
  return action !== 'download';
}
