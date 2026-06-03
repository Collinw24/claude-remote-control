export interface CloseDecisionInput {
  code: number;
  intentional: boolean;
  replaced: boolean;
}

export function getCloseCodeLabel(code: number): string {
  switch (code) {
    case 1000:
      return "NORMAL";
    case 1001:
      return "GOING_AWAY";
    case 1005:
      return "NO_STATUS";
    case 1006:
      return "ABNORMAL";
    default:
      return `code_${code}`;
  }
}

export function shouldReportConnectionLoss(input: CloseDecisionInput): boolean {
  return !input.intentional && !input.replaced && input.code !== 1000;
}

export function shouldReconnectAfterClose(input: CloseDecisionInput): boolean {
  return !input.intentional && !input.replaced && input.code !== 1000;
}

export function shouldUpdateConnectionStateAfterClose(input: CloseDecisionInput): boolean {
  return !input.replaced;
}
