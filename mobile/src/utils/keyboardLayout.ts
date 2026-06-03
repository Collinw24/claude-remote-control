const PROMPT_GAP = 10;

interface PromptInsetInput {
  keyboardHeight: number;
  safeAreaBottom: number;
}

export function getPromptBottomInset({ keyboardHeight, safeAreaBottom }: PromptInsetInput): number {
  const clampedKeyboardHeight = Math.max(0, keyboardHeight);
  if (clampedKeyboardHeight > 0) {
    return clampedKeyboardHeight + PROMPT_GAP;
  }

  return Math.max(PROMPT_GAP, safeAreaBottom + PROMPT_GAP);
}
