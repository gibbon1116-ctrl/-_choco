import {
  isWeekend,
  isoDate,
  monthDates,
  parseIsoDate,
} from "../utils/calendar.js";
import {
  CATEGORY_SKILL_FIELDS,
  SKILL_DEFINITIONS,
  employeeHasRole,
  employeeHasSkill,
  englishLevelRank,
  normalizeRelationType,
} from "../utils/restaurantSkills.js";
import { penalty } from "./config.js";
import {
  addAbsDiff,
  addAndVar,
  addMinimum,
  addSpread,
  addTargetDeviation,
} from "./linearization.js";

const KEY_SEPARATOR = "\u0000";

function requirementKey(date, shiftCode) {
  return `${date}${KEY_SEPARATOR}${shiftCode}`;
}

function variableKey(employeeId, date, shiftCode) {
  return `${employeeId}${KEY_SEPARATOR}${date}${KEY_SEPARATOR}${shiftCode}`;
}

function integer(value, fallback = 0) {
  const parsed = Number.parseInt(value ?? fallback, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function buildStaffRelationWeightLookup(staffRelations, dayCount, shiftCodeCount) {
  const tierCounts = new Map();
  Array.from(staffRelations ?? []).forEach((relation) => {
    if (!Boolean(relation.active) || relation.priority === "hard") return;
    const rawWeight = Math.max(0, integer(relation.weight));
    tierCounts.set(rawWeight, (tierCounts.get(rawWeight) ?? 0) + 1);
  });

  const effectiveWeights = new Map();
  const tiersAscending = [...tierCounts.keys()].sort((left, right) => left - right);
  const days = Math.max(0, integer(dayCount));
  const unitBound = days * Math.max(1, integer(shiftCodeCount));
  let lowerTierMaximum = 0;
  tiersAscending.forEach((rawWeight, tierIndex) => {
    const effectiveWeight = tierIndex === 0 ? rawWeight : lowerTierMaximum + 1;
    effectiveWeights.set(rawWeight, effectiveWeight);
    lowerTierMaximum += effectiveWeight * tierCounts.get(rawWeight) * unitBound;
  });
  return effectiveWeights;
}

function addDays(value, offset) {
  const date = parseIsoDate(value);
  date.setDate(date.getDate() + offset);
  return isoDate(date);
}

function safeName(value) {
  return String(value).replace(/[^A-Za-z0-9_]/g, "_");
}

function positiveTerms(variableNames) {
  return variableNames.map((variable) => ({ coefficient: 1, variable }));
}

function normalizeTerms(terms) {
  const coefficients = new Map();
  for (const term of terms) {
    if (!term?.variable) continue;
    const coefficient = Number(term.coefficient ?? 1);
    if (!Number.isFinite(coefficient) || coefficient === 0) continue;
    coefficients.set(
      term.variable,
      (coefficients.get(term.variable) ?? 0) + coefficient,
    );
  }
  return [...coefficients].filter(([, coefficient]) => coefficient !== 0).map(
    ([variable, coefficient]) => ({ variable, coefficient }),
  );
}

function formatTerms(inputTerms) {
  const terms = normalizeTerms(inputTerms);
  if (!terms.length) return "0";
  return terms.map(({ coefficient, variable }, index) => {
    const absolute = Math.abs(coefficient);
    const value = absolute === 1 ? variable : `${absolute} ${variable}`;
    if (index === 0) return coefficient < 0 ? `- ${value}` : value;
    return coefficient < 0 ? `- ${value}` : `+ ${value}`;
  }).join(" ");
}

class LpComposer {
  constructor(feasibilityOnly = false) {
    this.constraints = [];
    this.names = new Set();
    this.binaryVariables = [];
    this.binarySet = new Set();
    this.continuousVariables = new Map();
    this.objective = new Map();
    this.objectiveConstant = 0;
    this.softConstraintCount = 0;
    this.feasibilityOnly = feasibilityOnly;
  }

  uniqueName(name) {
    const base = safeName(name);
    let candidate = base;
    let suffix = 2;
    while (this.names.has(candidate)) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }
    this.names.add(candidate);
    return candidate;
  }

  addConstraint(name, terms, operator, rightHandSide) {
    this.constraints.push(
      ` ${this.uniqueName(name)}: ${formatTerms(terms)} ${operator} ${rightHandSide}`,
    );
  }

  addSoftConstraint(name, terms, operator, rightHandSide) {
    this.addConstraint(`s_${name}`, terms, operator, rightHandSide);
    this.softConstraintCount += 1;
  }

  addBinaryVariable(name) {
    if (this.binarySet.has(name)) return;
    if (this.continuousVariables.has(name)) {
      throw new Error(`変数 ${name} は既に連続変数として登録されています。`);
    }
    this.binarySet.add(name);
    this.binaryVariables.push(name);
  }

  addContinuousVariable(name, bounds = {}) {
    if (this.binarySet.has(name)) {
      throw new Error(`変数 ${name} は既にバイナリ変数として登録されています。`);
    }
    if (!this.continuousVariables.has(name)) {
      this.continuousVariables.set(name, {
        lower: bounds.lower ?? 0,
        upper: bounds.upper ?? Number.POSITIVE_INFINITY,
      });
    }
  }

  addObjectiveTerm(variable, coefficient) {
    if (this.feasibilityOnly) return;
    const value = Number(coefficient);
    if (!Number.isFinite(value) || value === 0) return;
    this.objective.set(variable, (this.objective.get(variable) ?? 0) + value);
  }

  addObjectiveConstant(value) {
    if (this.feasibilityOnly) return;
    const number = Number(value);
    if (Number.isFinite(number)) this.objectiveConstant += number;
  }

  objectiveExpression() {
    const terms = [...this.objective]
      .filter(([, coefficient]) => coefficient !== 0)
      .map(([variable, coefficient]) => ({ variable, coefficient }));
    const expression = formatTerms(terms);
    if (this.objectiveConstant === 0) return expression;
    if (expression === "0") return String(this.objectiveConstant);
    const sign = this.objectiveConstant < 0 ? "-" : "+";
    return `${expression} ${sign} ${Math.abs(this.objectiveConstant)}`;
  }

  boundLines() {
    const lines = [];
    for (const [name, bounds] of this.continuousVariables) {
      if (bounds.lower === 0 && bounds.upper === Number.POSITIVE_INFINITY) continue;
      if (bounds.upper === Number.POSITIVE_INFINITY) {
        lines.push(` ${bounds.lower} <= ${name}`);
      } else {
        lines.push(` ${bounds.lower} <= ${name} <= ${bounds.upper}`);
      }
    }
    return lines;
  }

  toLpString() {
    const bounds = this.boundLines();
    return [
      "Minimize",
      ` obj: ${this.objectiveExpression()}`,
      "Subject To",
      ...this.constraints,
      ...(bounds.length ? ["Bounds", ...bounds] : []),
      "Binary",
      ...this.binaryVariables.map((name) => ` ${name}`),
      "End",
    ].join("\n");
  }
}

function skillSetting(settings, code, defaultLevel = "1") {
  const current = settings.skills?.[code] ?? {};
  return {
    minimumLevel: current.minimum_level ?? defaultLevel,
    requiredCount: Math.max(0, integer(current.required_count)),
    priority: current.priority === "hard" ? "hard" : "soft",
  };
}

/** Build the H1-H12 model and all Phase 8 weighted soft constraints. */
export function buildModel(targetMonth, data = {}, {
  random = Math.random,
  relaxGroups = [],
  feasibilityOnly = false,
} = {}) {
  const relaxSet = new Set(relaxGroups ?? []);
  const days = monthDates(targetMonth);
  const employees = Array.from(data.employees ?? []).filter(
    (employee) => Boolean(employee.active),
  );
  const workShifts = Array.from(data.shiftTypes ?? []).filter(
    (shift) => Boolean(shift.is_work),
  );
  const requirements = Array.from(data.requirements ?? []);
  const requests = Array.from(data.requests ?? []);
  const settings = data.settings ?? {};
  const staffRelations = Array.from(data.staffRelations ?? []);
  const businessDayRows = Array.from(data.businessDays ?? []);
  const campaigns = Array.from(data.campaigns ?? []);
  const roleRequirements = Array.from(data.roleRequirements ?? []);
  const shiftCodes = workShifts.map((shift) => String(shift.shift_code));
  const employeeIds = new Set(employees.map((employee) => String(employee.employee_id)));
  const employeeMap = new Map(employees.map(
    (employee) => [String(employee.employee_id), employee],
  ));
  const validDays = new Set(days);
  const shiftCodeSet = new Set(shiftCodes);
  const model = new LpComposer(feasibilityOnly);

  const variables = [];
  const variableMap = {};
  const variableLookup = new Map();
  employees.forEach((employee, employeeIndex) => {
    days.forEach((date, dayIndex) => {
      workShifts.forEach((shift, shiftIndex) => {
        const name = `x_e${employeeIndex}_d${dayIndex}_c${shiftIndex}`;
        const metadata = {
          name,
          employee_id: String(employee.employee_id),
          date,
          shift_code: String(shift.shift_code),
        };
        variables.push(metadata);
        variableMap[name] = metadata;
        variableLookup.set(variableKey(metadata.employee_id, date, metadata.shift_code), name);
        model.addBinaryVariable(name);
      });
    });
  });

  const variableFor = (employeeId, date, shiftCode) => variableLookup.get(
    variableKey(String(employeeId), date, String(shiftCode)),
  );
  const variablesForDay = (employeeId, date) => shiftCodes.map(
    (shiftCode) => variableFor(employeeId, date, shiftCode),
  ).filter(Boolean);
  const variablesForEmployee = (employeeId, selectedDays = days) => selectedDays.flatMap(
    (date) => variablesForDay(employeeId, date),
  );
  const variablesForShift = (employeeId, shiftCode) => days.map(
    (date) => variableFor(employeeId, date, shiftCode),
  ).filter(Boolean);

  const counts = Object.fromEntries(
    Array.from({ length: 12 }, (_, index) => [`H${index + 1}`, 0]),
  );
  const addHardConstraint = (group, name, terms, operator, rightHandSide) => {
    if (group !== "H1" && relaxSet.has(group)) return;
    model.addConstraint(name, terms, operator, rightHandSide);
    counts[group] += 1;
  };
  const effectivePriority = (priority, group) => (
    relaxSet.has(group) ? "soft" : priority
  );

  // H1: one shift per employee and day.
  employees.forEach((employee, employeeIndex) => {
    days.forEach((date, dayIndex) => {
      addHardConstraint(
        "H1",
        `h1_e${employeeIndex}_d${dayIndex}`,
        positiveTerms(variablesForDay(employee.employee_id, date)),
        "<=",
        1,
      );
    });
  });

  // H2: employees without night permission cannot work N.
  if (shiftCodeSet.has("N")) {
    employees.forEach((employee, employeeIndex) => {
      if (Boolean(employee.night_allowed)) return;
      days.forEach((date, dayIndex) => {
        addHardConstraint(
          "H2",
          `h2_e${employeeIndex}_d${dayIndex}`,
          positiveTerms([variableFor(employee.employee_id, date, "N")]),
          "=",
          0,
        );
      });
    });
  }

  // H3: minimum coverage for every day and work-shift combination.
  const requirementMap = new Map();
  const requiredByDay = new Map();
  for (const row of requirements) {
    const count = integer(row.required_count);
    requirementMap.set(requirementKey(String(row.date), String(row.shift_code)), count);
    requiredByDay.set(String(row.date), (requiredByDay.get(String(row.date)) ?? 0) + count);
  }
  days.forEach((date, dayIndex) => {
    shiftCodes.forEach((shiftCode, shiftIndex) => {
      addHardConstraint(
        "H3",
        `h3_d${dayIndex}_c${shiftIndex}`,
        positiveTerms(employees.map(
          (employee) => variableFor(employee.employee_id, date, shiftCode),
        ).filter(Boolean)),
        ">=",
        requirementMap.get(requirementKey(date, shiftCode)) ?? 0,
      );
    });
  });

  // H4: monthly workday lower/upper bounds.
  employees.forEach((employee, employeeIndex) => {
    const terms = positiveTerms(variablesForEmployee(employee.employee_id));
    addHardConstraint(
      "H4",
      `h4_min_e${employeeIndex}`,
      terms,
      ">=",
      integer(employee.min_work_days),
    );
    addHardConstraint(
      "H4",
      `h4_max_e${employeeIndex}`,
      terms,
      "<=",
      Math.min(integer(employee.max_work_days, days.length), days.length),
    );
  });

  // H5: maximum consecutive workdays.
  employees.forEach((employee, employeeIndex) => {
    const maximum = Math.max(1, integer(employee.max_consecutive_days, 1));
    for (let start = 0; start < days.length - maximum; start += 1) {
      addHardConstraint(
        "H5",
        `h5_e${employeeIndex}_w${start}`,
        positiveTerms(variablesForEmployee(
          employee.employee_id,
          days.slice(start, start + maximum + 1),
        )),
        "<=",
        maximum,
      );
    }
  });

  // H6: rest on the day after a rest-requiring shift.
  const restShiftIndexes = workShifts
    .map((shift, index) => (Boolean(shift.requires_rest_next_day) ? index : -1))
    .filter((index) => index >= 0);
  employees.forEach((employee, employeeIndex) => {
    days.slice(0, -1).forEach((date, dayIndex) => {
      restShiftIndexes.forEach((shiftIndex) => {
        const terms = positiveTerms(variablesForDay(employee.employee_id, days[dayIndex + 1]));
        terms.push({
          coefficient: 1,
          variable: variableFor(employee.employee_id, date, shiftCodes[shiftIndex]),
        });
        addHardConstraint(
          "H6",
          `h6_e${employeeIndex}_d${dayIndex}_c${shiftIndex}`,
          terms,
          "<=",
          1,
        );
      });
    });
  });

  // H7/H8 and soft requests.
  requests.forEach((request, requestIndex) => {
    const employeeId = String(request.employee_id);
    const date = String(request.date);
    const shiftCode = String(request.shift_code || "O");
    if (!employeeIds.has(employeeId) || !validDays.has(date)) return;
    const dailyVariables = variablesForDay(employeeId, date);

    if (request.priority === "hard") {
      if (
        request.request_type === "off"
        || (
          request.request_type === "fixed"
          && shiftCode === "O"
        )
      ) {
        addHardConstraint(
          "H7",
          `h7_r${requestIndex}`,
          positiveTerms(dailyVariables),
          "=",
          0,
        );
      } else if (
        request.request_type === "fixed"
        && shiftCodeSet.has(shiftCode)
      ) {
        addHardConstraint(
          "H8",
          `h8_r${requestIndex}`,
          positiveTerms([variableFor(employeeId, date, shiftCode)]),
          "=",
          1,
        );
      } else if (request.request_type === "prefer" && shiftCodeSet.has(shiftCode)) {
        for (const otherCode of shiftCodes) {
          if (otherCode === shiftCode) continue;
          addHardConstraint(
            "H8",
            `h8_r${requestIndex}_${otherCode}`,
            positiveTerms([variableFor(employeeId, date, otherCode)]),
            "=",
            0,
          );
        }
      } else if (request.request_type === "avoid" && shiftCodeSet.has(shiftCode)) {
        addHardConstraint(
          "H8",
          `h8_r${requestIndex}`,
          positiveTerms([variableFor(employeeId, date, shiftCode)]),
          "=",
          0,
        );
      }
      return;
    }

    if (request.request_type === "off") {
      dailyVariables.forEach((variable) => model.addObjectiveTerm(
        variable,
        penalty("soft_request_off_violation"),
      ));
    } else if (request.request_type === "avoid" && shiftCodeSet.has(shiftCode)) {
      model.addObjectiveTerm(
        variableFor(employeeId, date, shiftCode),
        penalty("avoid_shift_assigned"),
      );
    } else if (
      ["prefer", "fixed"].includes(request.request_type)
      && shiftCodeSet.has(shiftCode)
    ) {
      model.addObjectiveConstant(penalty("prefer_request_not_satisfied"));
      model.addObjectiveTerm(
        variableFor(employeeId, date, shiftCode),
        -penalty("prefer_request_not_satisfied"),
      );
    }
  });

  if (Boolean(settings.restaurant_mode)) {
    // H9/H10: opener/closer coverage.
    if (shiftCodeSet.has("E")) {
      const openers = employees.filter((employee) => employeeHasRole(employee, "opener"));
      days.forEach((date, dayIndex) => {
        if ((requirementMap.get(requirementKey(date, "E")) ?? 0) < 1) return;
        addHardConstraint(
          "H9",
          `h9_d${dayIndex}`,
          positiveTerms(openers.map(
            (employee) => variableFor(employee.employee_id, date, "E"),
          )),
          ">=",
          1,
        );
      });
    }
    if (shiftCodeSet.has("L")) {
      const closers = employees.filter((employee) => employeeHasRole(employee, "closer"));
      days.forEach((date, dayIndex) => {
        if ((requirementMap.get(requirementKey(date, "L")) ?? 0) < 1) return;
        addHardConstraint(
          "H10",
          `h10_d${dayIndex}`,
          positiveTerms(closers.map(
            (employee) => variableFor(employee.employee_id, date, "L"),
          )),
          ">=",
          1,
        );
      });
    }

    // H12: a required shift cannot consist only of newcomers.
    const newcomers = employees.filter((employee) => Boolean(employee.is_new_staff));
    const experienced = employees.filter((employee) => !Boolean(employee.is_new_staff));
    if (newcomers.length) {
      days.forEach((date, dayIndex) => {
        shiftCodes.forEach((shiftCode, shiftIndex) => {
          if ((requirementMap.get(requirementKey(date, shiftCode)) ?? 0) < 1) return;
          addHardConstraint(
            "H12",
            `h12_d${dayIndex}_c${shiftIndex}`,
            [
              ...positiveTerms(newcomers.map(
                (employee) => variableFor(employee.employee_id, date, shiftCode),
              )),
              ...experienced.map((employee) => ({
                coefficient: -newcomers.length,
                variable: variableFor(employee.employee_id, date, shiftCode),
              })),
            ],
            "<=",
            0,
          );
        });
      });
    }

    const businessDays = new Map(businessDayRows.map((row) => [String(row.date), row]));
    const openDays = days.filter(
      (date) => (requiredByDay.get(date) ?? 0) > 0
        && Boolean(businessDays.get(date)?.is_open ?? 1),
    );
    const activeCampaigns = (date) => campaigns.filter(
      (campaign) => String(campaign.start_date) <= date && date <= String(campaign.end_date),
    );

    const english = skillSetting(settings, "english_support", "basic");
    if (english.requiredCount > 0) {
      const level = englishLevelRank(english.minimumLevel);
      const qualified = employees.filter((employee) => employeeHasRole(
        employee,
        "english_support",
        { skillLevel: level },
      ));
      const needed = Math.max(1, english.requiredCount);
      for (const date of openDays) {
        if (settings.require_english_per_shift) {
          shiftCodes.forEach((shiftCode, shiftIndex) => {
            if ((requirementMap.get(requirementKey(date, shiftCode)) ?? 0) < 1) return;
            addMinimum(
              model,
              positiveTerms(qualified.map(
                (employee) => variableFor(employee.employee_id, date, shiftCode),
              )),
              needed,
              effectivePriority(english.priority, "SKILL"),
              penalty("english_missing"),
              `english_${days.indexOf(date)}_${shiftIndex}`,
            );
          });
        } else {
          addMinimum(
            model,
            positiveTerms(qualified.flatMap(
              (employee) => variablesForDay(employee.employee_id, date),
            )),
            needed,
            effectivePriority(english.priority, "SKILL"),
            penalty("english_missing"),
            `english_${days.indexOf(date)}`,
          );
        }
      }
    }

    const allergy = skillSetting(settings, "allergy_support");
    if (allergy.requiredCount > 0) {
      const qualified = employees.filter(
        (employee) => employeeHasRole(employee, "allergy_support"),
      );
      openDays.forEach((date, dayIndex) => addMinimum(
        model,
        positiveTerms(qualified.flatMap(
          (employee) => variablesForDay(employee.employee_id, date),
        )),
        Math.max(1, allergy.requiredCount),
        effectivePriority(allergy.priority, "SKILL"),
        penalty("allergy_support_missing"),
        `allergy_${dayIndex}`,
      ));
    }

    const newProduct = skillSetting(settings, "new_product");
    // Phase 1's merged settings schema has no require_new_product flag. An explicit
    // flag wins; otherwise a positive required_count is the enable switch used by the UI.
    const requireNewProduct = settings.require_new_product === undefined
      ? newProduct.requiredCount > 0
      : Boolean(settings.require_new_product);
    openDays.forEach((date, dayIndex) => {
      const todaysCampaigns = activeCampaigns(date);
      const businessDay = businessDays.get(date) ?? {};
      if (!todaysCampaigns.length && !Boolean(businessDay.new_product_active)) return;

      const configuredLevel = integer(newProduct.minimumLevel, 1);
      const requiredLevel = Math.max(
        configuredLevel,
        ...todaysCampaigns.map((campaign) => integer(campaign.required_skill_level, 2)),
      );
      if (requireNewProduct) {
        const qualified = employees.filter(
          (employee) => integer(employee.new_product_skill) >= requiredLevel,
        );
        addMinimum(
          model,
          positiveTerms(qualified.flatMap(
            (employee) => variablesForDay(employee.employee_id, date),
          )),
          Math.max(1, newProduct.requiredCount),
          effectivePriority(newProduct.priority, "SKILL"),
          penalty("new_product_missing"),
          `new_product_${dayIndex}`,
        );
      }

      todaysCampaigns.forEach((campaign, campaignIndex) => {
        const campaignName = safeName(campaign.id ?? campaignIndex);
        const skillField = CATEGORY_SKILL_FIELDS[campaign.category];
        if (skillField) {
          const qualified = employees.filter(
            (employee) => integer(employee[skillField]) >= integer(campaign.required_skill_level, 2),
          );
          addMinimum(
            model,
            positiveTerms(qualified.flatMap(
              (employee) => variablesForDay(employee.employee_id, date),
            )),
            1,
            "soft",
            penalty("category_skill_missing"),
            `category_${campaignName}_${dayIndex}`,
          );
        }
        if (
          Boolean(campaign.require_leader_first_week)
          && date < addDays(String(campaign.start_date), 7)
        ) {
          const leaders = employees.filter(
            (employee) => integer(employee.new_product_skill) >= 3,
          );
          addMinimum(
            model,
            positiveTerms(leaders.flatMap(
              (employee) => variablesForDay(employee.employee_id, date),
            )),
            1,
            "soft",
            penalty("new_product_leader_missing"),
            `product_leader_${campaignName}_${dayIndex}`,
          );
        }
      });
    });

    for (const definition of SKILL_DEFINITIONS) {
      if (["english_support", "new_product", "allergy_support"].includes(definition.code)) {
        continue;
      }
      const setting = skillSetting(settings, definition.code);
      if (setting.requiredCount <= 0) continue;
      const qualified = employees.filter((employee) => employeeHasSkill(
        employee,
        definition.code,
        setting.minimumLevel,
      ));
      openDays.forEach((date, dayIndex) => addMinimum(
        model,
        positiveTerms(qualified.flatMap(
          (employee) => variablesForDay(employee.employee_id, date),
        )),
        setting.requiredCount,
        effectivePriority(setting.priority, "SKILL"),
        penalty("role_requirement_missing"),
        `skill_${definition.code}_${dayIndex}`,
      ));
    }

    roleRequirements.forEach((requirement, requirementIndex) => {
      const date = String(requirement.date);
      const shiftCode = String(requirement.shift_code);
      if (!validDays.has(date) || !shiftCodeSet.has(shiftCode)) return;
      const qualified = employees.filter(
        (employee) => employeeHasRole(employee, requirement.role_code),
      );
      addMinimum(
        model,
        positiveTerms(qualified.map(
          (employee) => variableFor(employee.employee_id, date, shiftCode),
        )),
        integer(requirement.required_count),
        effectivePriority(requirement.priority, "ROLE"),
        penalty("role_requirement_missing"),
        `role_${safeName(requirement.id ?? requirementIndex)}`,
      );
    });

    if (shiftCodeSet.has("L") && shiftCodeSet.has("E")) {
      employees.forEach((employee, employeeIndex) => {
        for (let dayIndex = 0; dayIndex < days.length - 1; dayIndex += 1) {
          addAndVar(
            model,
            variableFor(employee.employee_id, days[dayIndex], "L"),
            variableFor(employee.employee_id, days[dayIndex + 1], "E"),
            penalty("close_to_open"),
            `close_open_e${employeeIndex}_d${dayIndex}`,
          );
        }
      });
    }

    const highDays = days.filter(
      (date) => ["high", "very_high"].includes(businessDays.get(date)?.demand_level),
    );
    const mentorGroups = new Map();
    const staffRelationWeights = buildStaffRelationWeightLookup(
      staffRelations,
      days.length,
      shiftCodes.length,
    );
    staffRelations.forEach((relation, relationIndex) => {
      if (!Boolean(relation.active)) return;
      const employeeId1 = String(relation.employee_id_1);
      const employeeId2 = String(relation.employee_id_2);
      if (!employeeMap.has(employeeId1) || !employeeMap.has(employeeId2)) return;
      const relationType = normalizeRelationType(relation.relation_type);
      const rawWeight = Math.max(0, integer(relation.weight));
      const weight = staffRelationWeights.get(rawWeight) ?? rawWeight;
      const relationName = `relation_${safeName(relation.id ?? relationIndex)}`;
      if (relationType === "mentor_pair") {
        const employee1 = employeeMap.get(employeeId1);
        const employee2 = employeeMap.get(employeeId2);
        const employee1IsMentee = Boolean(employee1.is_new_staff)
          && !Boolean(employee1.can_train_new_staff);
        const employee1IsMentor = Boolean(employee1.can_train_new_staff)
          && !Boolean(employee1.is_new_staff);
        const employee2IsMentee = Boolean(employee2.is_new_staff)
          && !Boolean(employee2.can_train_new_staff);
        const employee2IsMentor = Boolean(employee2.can_train_new_staff)
          && !Boolean(employee2.is_new_staff);
        const firstToSecond = employee1IsMentee && employee2IsMentor;
        const secondToFirst = employee2IsMentee && employee1IsMentor;
        if (firstToSecond === secondToFirst) return;

        const menteeId = firstToSecond ? employeeId1 : employeeId2;
        const mentorId = firstToSecond ? employeeId2 : employeeId1;
        const group = mentorGroups.get(menteeId) ?? {
          mentors: new Set(),
          hard: false,
          softWeight: 0,
        };
        group.mentors.add(mentorId);
        if (relation.priority === "hard") {
          group.hard = true;
        } else {
          group.softWeight = Math.max(group.softWeight, weight);
        }
        mentorGroups.set(menteeId, group);
        return;
      }
      if (["prefer_together", "prefer_peak_pair"].includes(
        relationType,
      )) {
        const selectedDays = relationType === "prefer_peak_pair" ? highDays : days;
        selectedDays.forEach((date, dayIndex) => {
          const firstTerms = positiveTerms(variablesForDay(employeeId1, date));
          const secondTerms = positiveTerms(variablesForDay(employeeId2, date));
          if (relation.priority === "hard") {
            addHardConstraint(
              "H11",
              `h11_${relationName}_d${dayIndex}`,
              [
                ...firstTerms,
                ...secondTerms.map((term) => ({
                  coefficient: -1,
                  variable: term.variable,
                })),
              ],
              "=",
              0,
            );
            return;
          }
          addAbsDiff(
            model,
            firstTerms,
            secondTerms,
            weight,
            `${relationName}_d${dayIndex}`,
          );
        });
        return;
      }
      if (relationType === "avoid_together") {
        days.forEach((date, dayIndex) => {
          if (relation.priority === "hard") {
            addHardConstraint(
              "H11",
              `h11_${relationName}_d${dayIndex}`,
              positiveTerms([
                ...variablesForDay(employeeId1, date),
                ...variablesForDay(employeeId2, date),
              ]),
              "<=",
              1,
            );
            return;
          }

          shiftCodes.forEach((shiftCode, shiftIndex) => {
            const pairVariables = [
              variableFor(employeeId1, date, shiftCode),
              variableFor(employeeId2, date, shiftCode),
            ].filter(Boolean);
            if (pairVariables.length < 2) return;
            addHardConstraint(
              "H11",
              `h11_${relationName}_d${dayIndex}_c${shiftIndex}`,
              positiveTerms(pairVariables),
              "<=",
              1,
            );
          });

          const overlap = `overlap_${relationName}_d${dayIndex}`;
          model.addContinuousVariable(overlap, { lower: 0, upper: 1 });
          model.addSoftConstraint(
            overlap,
            [
              { coefficient: 1, variable: overlap },
              ...variablesForDay(employeeId1, date).map(
                (variable) => ({ coefficient: -1, variable }),
              ),
              ...variablesForDay(employeeId2, date).map(
                (variable) => ({ coefficient: -1, variable }),
              ),
            ],
            ">=",
            -1,
          );
          model.addObjectiveTerm(overlap, weight);
        });
        return;
      }
      if (relationType !== "avoid_closing_pair") return;
      const codes = shiftCodeSet.has("L") ? ["L"] : [];
      days.forEach((date, dayIndex) => {
        codes.forEach((shiftCode, shiftIndex) => {
          const suffix = `${relationName}_d${dayIndex}_c${shiftIndex}`;
          if (relation.priority === "hard") {
            const pairVariables = [
              variableFor(employeeId1, date, shiftCode),
              variableFor(employeeId2, date, shiftCode),
            ].filter(Boolean);
            if (pairVariables.length < 2) return;
            addHardConstraint(
              "H11",
              `h11_${suffix}`,
              positiveTerms(pairVariables),
              "<=",
              1,
            );
            return;
          }
          addAndVar(
            model,
            variableFor(employeeId1, date, shiftCode),
            variableFor(employeeId2, date, shiftCode),
            weight,
            suffix,
          );
        });
      });
    });

    mentorGroups.forEach((group, menteeId) => {
      const mentorIds = [...group.mentors].filter((mentorId) => employeeMap.has(mentorId));
      if (!mentorIds.length) return;
      const menteeName = safeName(menteeId);
      days.forEach((date, dayIndex) => {
        shiftCodes.forEach((shiftCode, shiftIndex) => {
          if ((requirementMap.get(requirementKey(date, shiftCode)) ?? 0) < 1) return;
          const menteeVariable = variableFor(menteeId, date, shiftCode);
          const mentorVariables = mentorIds.map(
            (mentorId) => variableFor(mentorId, date, shiftCode),
          ).filter(Boolean);
          if (!menteeVariable || !mentorVariables.length) return;
          const suffix = `mentor_pair_${menteeName}_d${dayIndex}_c${shiftIndex}`;
          if (group.hard) {
            addHardConstraint(
              "H12",
              `h12_${suffix}`,
              [
                { coefficient: 1, variable: menteeVariable },
                ...mentorVariables.map((variable) => ({ coefficient: -1, variable })),
              ],
              "<=",
              0,
            );
            return;
          }

          const shortfall = `shortfall_${suffix}`;
          model.addContinuousVariable(shortfall, { lower: 0, upper: 1 });
          model.addSoftConstraint(
            suffix,
            [
              ...positiveTerms(mentorVariables),
              { coefficient: 1, variable: shortfall },
              { coefficient: -1, variable: menteeVariable },
            ],
            ">=",
            0,
          );
          model.addObjectiveTerm(shortfall, group.softWeight);
        });
      });
    });
  }

  // Fair distribution of workdays, nights, weekends and each shift code.
  const workGroups = employees.map(
    (employee) => positiveTerms(variablesForEmployee(employee.employee_id)),
  );
  const totalRequiredWork = [...requirementMap.values()].reduce(
    (sum, count) => sum + Math.max(0, count),
    0,
  );
  addTargetDeviation(
    model,
    workGroups,
    totalRequiredWork,
    penalty("workday_target_deviation"),
    "work_target",
    days.length,
  );
  addSpread(model, workGroups, penalty("workday_imbalance"), "work");

  if (shiftCodeSet.has("N")) {
    const nightGroups = employees.filter(
      (employee) => Boolean(employee.night_allowed),
    ).map((employee) => positiveTerms(variablesForShift(employee.employee_id, "N")));
    addSpread(model, nightGroups, penalty("night_shift_imbalance"), "night");
  }
  const weekendDays = days.filter(isWeekend);
  const weekendGroups = employees.map((employee) => positiveTerms(
    variablesForEmployee(employee.employee_id, weekendDays),
  ));
  addSpread(model, weekendGroups, penalty("weekend_shift_imbalance"), "weekend");

  const english = skillSetting(settings, "english_support", "basic");
  const balanceCandidatesForShift = (shiftCode) => {
    const maximumRequired = Math.max(
      ...days.map((date) => requirementMap.get(requirementKey(date, shiftCode)) ?? 0),
    );
    const candidates = employees.filter((employee) => {
      if (shiftCode === "N" && !Boolean(employee.night_allowed)) return false;
      if (settings.restaurant_mode) {
        if (shiftCode === "E" && !employeeHasRole(employee, "opener")) return false;
        if (shiftCode === "L" && !employeeHasRole(employee, "closer")) return false;
        if (Boolean(employee.is_new_staff) && maximumRequired <= 1) return false;
        if (
          english.requiredCount > 0
          && english.priority === "hard"
          && settings.require_english_per_shift
          && maximumRequired <= Math.max(1, english.requiredCount)
          && !employeeHasRole(employee, "english_support", {
            skillLevel: englishLevelRank(english.minimumLevel),
          })
        ) return false;
      }
      return true;
    });
    return candidates.length ? candidates : employees;
  };

  shiftCodes.forEach((shiftCode, shiftIndex) => {
    const total = days.reduce(
      (sum, date) => sum + Math.max(
        0,
        requirementMap.get(requirementKey(date, shiftCode)) ?? 0,
      ),
      0,
    );
    if (total <= 0) return;
    const groups = balanceCandidatesForShift(shiftCode).map(
      (employee) => positiveTerms(variablesForShift(employee.employee_id, shiftCode)),
    );
    addTargetDeviation(
      model,
      groups,
      total,
      penalty("shift_type_target_deviation"),
      `shift_target_${shiftIndex}`,
      days.length,
    );
    addSpread(
      model,
      groups,
      penalty("shift_type_imbalance"),
      `shift_${shiftIndex}`,
    );
  });

  employees.forEach((employee, employeeIndex) => {
    for (let dayIndex = 0; dayIndex < days.length - 1; dayIndex += 1) {
      shiftCodes.forEach((shiftCode, shiftIndex) => addAndVar(
        model,
        variableFor(employee.employee_id, days[dayIndex], shiftCode),
        variableFor(employee.employee_id, days[dayIndex + 1], shiftCode),
        penalty("same_shift_streak"),
        `same_shift_e${employeeIndex}_d${dayIndex}_c${shiftIndex}`,
      ));
    }
  });

  const randomWeight = penalty("random_assignment_tiebreaker");
  variables.forEach(({ name }) => model.addObjectiveTerm(
    name,
    Math.floor(random() * (randomWeight + 1)),
  ));

  const lpString = model.toLpString();
  return {
    targetMonth,
    lpString,
    variables,
    variableMap,
    binaryVariables: [...model.binaryVariables],
    days,
    shiftCodes,
    employeeIds: employees.map((employee) => String(employee.employee_id)),
    stats: {
      variableCount: variables.length,
      assignmentVariableCount: variables.length,
      binaryVariableCount: model.binaryVariables.length,
      continuousVariableCount: model.continuousVariables.size,
      totalVariableCount: model.binaryVariables.length + model.continuousVariables.size,
      constraintCount: model.constraints.length,
      softConstraintCount: model.softConstraintCount,
      objectiveTermCount: model.objective.size,
      constraintsByGroup: counts,
    },
  };
}
