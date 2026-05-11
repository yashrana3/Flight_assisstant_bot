export const ADMIN_ALLOWED_RANGE_DAYS = [7, 15, 30] as const;

export type AdminRangeDays = (typeof ADMIN_ALLOWED_RANGE_DAYS)[number];

const RANGE_VALUE_MAP: Record<string, AdminRangeDays> = {
  "7d": 7,
  "7 days": 7,
  "15d": 15,
  "15 days": 15,
  "30d": 30,
  "30 days": 30,
};

export function toRangeDays(input: string | null | undefined): AdminRangeDays {
  if (!input) return 7;
  const normalized = input.trim().toLowerCase();
  return RANGE_VALUE_MAP[normalized] ?? 7;
}

export function toRangeValue(days: AdminRangeDays): string {
  return `${days}d`;
}

