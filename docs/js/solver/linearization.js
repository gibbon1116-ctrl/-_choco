function safeName(value) {
  return String(value).replace(/[^A-Za-z0-9_]/g, "_");
}

function terms(expression) {
  return Array.from(expression ?? [], (term) => (
    typeof term === "string"
      ? { coefficient: 1, variable: term }
      : { coefficient: Number(term.coefficient ?? 1), variable: term.variable }
  ));
}

/** Coverage lower bound with either a hard constraint or a penalized shortfall. */
export function addMinimum(model, actualTerms, needed, priority, weight, name) {
  const required = Math.max(0, Number(needed));
  if (required <= 0) return null;
  const actual = terms(actualTerms);
  const suffix = safeName(name);

  if (priority === "hard") {
    model.addSoftConstraint(`minimum_${suffix}`, actual, ">=", required);
    return null;
  }

  const shortfall = `shortfall_${suffix}`;
  model.addContinuousVariable(shortfall, { lower: 0, upper: required });
  model.addSoftConstraint(
    `minimum_${suffix}`,
    [...actual, { coefficient: 1, variable: shortfall }],
    ">=",
    required,
  );
  model.addObjectiveTerm(shortfall, Number(weight));
  return shortfall;
}

/** Penalize max(values) - min(values). */
export function addSpread(model, variableTermGroups, weight, name) {
  const groups = Array.from(variableTermGroups ?? [], terms);
  if (groups.length < 2 || Number(weight) <= 0) return null;

  const suffix = safeName(name);
  const high = `hi_${suffix}`;
  const low = `lo_${suffix}`;
  model.addContinuousVariable(high);
  model.addContinuousVariable(low);

  groups.forEach((group, index) => {
    model.addSoftConstraint(
      `spread_hi_${suffix}_${index}`,
      [{ coefficient: 1, variable: high }, ...group.map((term) => ({
        coefficient: -term.coefficient,
        variable: term.variable,
      }))],
      ">=",
      0,
    );
    model.addSoftConstraint(
      `spread_lo_${suffix}_${index}`,
      [...group, { coefficient: -1, variable: low }],
      ">=",
      0,
    );
  });

  model.addObjectiveTerm(high, Number(weight));
  model.addObjectiveTerm(low, -Number(weight));
  return { high, low };
}

/** Penalize squared distance outside the fair [floor(target), ceil(target)] band. */
export function addTargetDeviation(
  model,
  variableTermGroups,
  total,
  weight,
  name,
  numDays,
) {
  const groups = Array.from(variableTermGroups ?? [], terms);
  const overall = Number(total);
  const cost = Number(weight);
  if (groups.length < 2 || overall <= 0 || cost <= 0) return [];

  const targetLow = Math.floor(overall / groups.length);
  const targetHigh = Math.ceil(overall / groups.length);
  const suffix = safeName(name);
  const created = [];

  groups.forEach((group, index) => {
    const over = [];
    const under = [];
    for (let extra = 1; extra <= numDays; extra += 1) {
      if (targetHigh + extra <= numDays) {
        const variable = `s_over_${suffix}_${index}_${extra}`;
        model.addContinuousVariable(variable, { lower: 0, upper: 1 });
        model.addObjectiveTerm(variable, cost * (2 * extra - 1));
        over.push(variable);
        created.push(variable);
      }
      if (targetLow - extra >= 0) {
        const variable = `s_under_${suffix}_${index}_${extra}`;
        model.addContinuousVariable(variable, { lower: 0, upper: 1 });
        model.addObjectiveTerm(variable, cost * (2 * extra - 1));
        under.push(variable);
        created.push(variable);
      }
    }

    if (over.length) {
      model.addSoftConstraint(
        `target_over_${suffix}_${index}`,
        [
          ...group,
          ...over.map((variable) => ({ coefficient: -1, variable })),
        ],
        "<=",
        targetHigh,
      );
    }
    if (under.length) {
      model.addSoftConstraint(
        `target_under_${suffix}_${index}`,
        [
          ...group,
          ...under.map((variable) => ({ coefficient: 1, variable })),
        ],
        ">=",
        targetLow,
      );
    }
  });

  return created;
}

/** Binary AND used for simultaneous-assignment penalties. */
export function addAndVar(model, variable1, variable2, weight, name) {
  const both = `both_${safeName(name)}`;
  model.addBinaryVariable(both);
  model.addSoftConstraint(
    `and_upper_1_${safeName(name)}`,
    [{ coefficient: 1, variable: both }, { coefficient: -1, variable: variable1 }],
    "<=",
    0,
  );
  model.addSoftConstraint(
    `and_upper_2_${safeName(name)}`,
    [{ coefficient: 1, variable: both }, { coefficient: -1, variable: variable2 }],
    "<=",
    0,
  );
  model.addSoftConstraint(
    `and_lower_${safeName(name)}`,
    [
      { coefficient: 1, variable: both },
      { coefficient: -1, variable: variable1 },
      { coefficient: -1, variable: variable2 },
    ],
    ">=",
    -1,
  );
  model.addObjectiveTerm(both, Number(weight));
  return both;
}

/** Penalize the absolute difference between two linear expressions. */
export function addAbsDiff(model, expression1, expression2, weight, name) {
  const suffix = safeName(name);
  const mismatch = `mismatch_${suffix}`;
  const first = terms(expression1);
  const second = terms(expression2);
  model.addContinuousVariable(mismatch);
  model.addSoftConstraint(
    `abs_1_${suffix}`,
    [
      { coefficient: 1, variable: mismatch },
      ...first.map((term) => ({ coefficient: -term.coefficient, variable: term.variable })),
      ...second,
    ],
    ">=",
    0,
  );
  model.addSoftConstraint(
    `abs_2_${suffix}`,
    [
      { coefficient: 1, variable: mismatch },
      ...second.map((term) => ({ coefficient: -term.coefficient, variable: term.variable })),
      ...first,
    ],
    ">=",
    0,
  );
  model.addObjectiveTerm(mismatch, Number(weight));
  return mismatch;
}
