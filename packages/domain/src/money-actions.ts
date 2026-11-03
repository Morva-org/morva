// Rules for actions that move or redirect a merchant's money. Every one is signed by the
// merchant's passkey in the browser; these rules decide whether it may go ahead at all.

export type MoneyActionType = "withdraw" | "payout_change" | "refund";

export interface MoneyAction {
  type: MoneyActionType;
  /** Value at stake in USD micro-units (6 decimals). Payout changes use the merchant's current balance. */
  usdMicro: bigint;
}

/** Above this, withdrawals and payout changes need a backup passkey first. */
export const BACKUP_REQUIRED_ABOVE_USD_MICRO = 100_000_000n;

export type MoneyActionVerdict = { allowed: true } | { allowed: false; reason: "backup_required"; message: string };

export function checkMoneyAction(action: MoneyAction, activePasskeys: number): MoneyActionVerdict {
  const gated = action.type === "withdraw" || action.type === "payout_change";
  if (gated && action.usdMicro > BACKUP_REQUIRED_ABOVE_USD_MICRO && activePasskeys < 2) {
    return {
      allowed: false,
      reason: "backup_required",
      message:
        "Add a backup device first. Your passkey is the only way into your balance, so for amounts over $100 we ask for a second one in case this device is lost.",
    };
  }
  return { allowed: true };
}
