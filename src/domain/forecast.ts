import { z } from "zod";

const wholeNonnegative = z.number().int().nonnegative();

export const forecastInputSchema = z
  .object({
    unrefinedLow: wholeNonnegative,
    unrefinedExpected: wholeNonnegative,
    unrefinedHigh: wholeNonnegative,
    horizonShare: z.number().int().min(0).max(100)
  })
  .refine((value) => value.unrefinedLow <= value.unrefinedExpected, {
    message: "Unrefined low must not exceed expected"
  })
  .refine((value) => value.unrefinedExpected <= value.unrefinedHigh, {
    message: "Unrefined expected must not exceed high"
  });

export type ForecastRangeInput = z.infer<typeof forecastInputSchema>;

export function validateForecastInput(value: unknown) {
  return forecastInputSchema.safeParse(value);
}

export function calculateForecast(
  input: ForecastRangeInput & { completedActual: number | null; detailedOpen: number | null }
) {
  const parsed = forecastInputSchema.safeParse(input);
  if (!parsed.success || input.completedActual === null || input.detailedOpen === null) return null;

  const base = input.completedActual + input.detailedOpen;
  const remaining = {
    low: input.detailedOpen + input.unrefinedLow,
    expected: input.detailedOpen + input.unrefinedExpected,
    high: input.detailedOpen + input.unrefinedHigh
  };

  return {
    lifetime: {
      low: base + input.unrefinedLow,
      expected: base + input.unrefinedExpected,
      high: base + input.unrefinedHigh
    },
    remaining,
    horizonDemand: {
      expected: Math.ceil((remaining.expected * input.horizonShare) / 100),
      high: Math.ceil((remaining.high * input.horizonShare) / 100)
    }
  };
}

export function forecastIntegrityWarning(
  completedActual: number | null,
  detailedOpen: number | null,
  baselineLifetimeHigh: number | null
): string | null {
  if (completedActual === null || detailedOpen === null || baselineLifetimeHigh === null)
    return null;
  return completedActual + detailedOpen > baselineLifetimeHigh
    ? "Current completed and detailed work exceeds the latest user-authored lifetime-high forecast. Save a new forecast revision before marking this project Ready."
    : null;
}

export function refinementStatus(
  startDate: string | null,
  leadTimeDays: number,
  forecast: ForecastRangeInput,
  now: Date
): { target: string | null; state: "unknown" | "planned" | "overdue" | "refined" } {
  const refined =
    forecast.unrefinedLow === 0 && forecast.unrefinedExpected === 0 && forecast.unrefinedHigh === 0;

  if (!startDate) return { target: null, state: refined ? "refined" : "unknown" };

  const targetDate = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(targetDate.valueOf()))
    return { target: null, state: refined ? "refined" : "unknown" };
  targetDate.setUTCDate(targetDate.getUTCDate() - leadTimeDays);
  const target = targetDate.toISOString().slice(0, 10);

  if (refined) return { target, state: "refined" };
  return { target, state: now.valueOf() > targetDate.valueOf() ? "overdue" : "planned" };
}
