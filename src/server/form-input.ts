function requiredString(form: FormData, key: string): string {
  const value = form.get(key);
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

function requiredNumber(form: FormData, key: string): number {
  const raw = requiredString(form, key);
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${key} must be a number`);
  return value;
}

export function parsePlanForm(form: FormData) {
  const names = form.getAll("laneName");
  const allocations = form.getAll("laneAllocation");
  if (names.length === 0 || names.length !== allocations.length) {
    throw new Error("At least one complete capacity lane is required");
  }

  return {
    name: requiredString(form, "name"),
    teamId: requiredString(form, "teamId"),
    membershipLabelId: requiredString(form, "membershipLabelId"),
    commitmentStatusId: requiredString(form, "commitmentStatusId"),
    horizonWeeks: requiredNumber(form, "horizonWeeks"),
    weeklyCapacity: requiredNumber(form, "weeklyCapacity"),
    capacityEffectiveDate: requiredString(form, "capacityEffectiveDate"),
    refinementLeadTimeDays: requiredNumber(form, "refinementLeadTimeDays"),
    lanes: names.map((name, index) => {
      if (typeof name !== "string" || name.trim() === "") throw new Error("Lane name is required");
      const rawAllocation = allocations[index];
      if (typeof rawAllocation !== "string" || rawAllocation.trim() === "") {
        throw new Error("Lane allocation is required");
      }
      const weeklyAllocation = Number(rawAllocation);
      if (!Number.isFinite(weeklyAllocation)) throw new Error("Lane allocation must be a number");
      return { name: name.trim(), weeklyAllocation };
    })
  };
}

export function parseForecastForm(form: FormData) {
  return {
    projectId: requiredString(form, "projectId"),
    unrefinedLow: requiredNumber(form, "unrefinedLow"),
    unrefinedExpected: requiredNumber(form, "unrefinedExpected"),
    unrefinedHigh: requiredNumber(form, "unrefinedHigh"),
    confidence: requiredString(form, "confidence"),
    estimateBasis: requiredString(form, "estimateBasis"),
    forecastAsOfDate: requiredString(form, "forecastAsOfDate"),
    capacityLaneId: requiredString(form, "capacityLaneId"),
    horizonSharePercent: requiredNumber(form, "horizonSharePercent"),
    reason: requiredString(form, "reason"),
    category: requiredString(form, "category")
  };
}
