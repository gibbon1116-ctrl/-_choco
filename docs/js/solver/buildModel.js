import { monthDates } from "../utils/calendar.js";
import { employeeHasRole } from "../utils/restaurantSkills.js";

const KEY_SEPARATOR = "\u0000";

function requirementKey(date, shiftCode) {
  return `${date}${KEY_SEPARATOR}${shiftCode}`;
}

function personDayKey(employeeId, date) {
  return `${employeeId}${KEY_SEPARATOR}${date}`;
}

function integer(value, fallback = 0) {
  const parsed = Number.parseInt(value ?? fallback, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatTerms(terms) {
  if (!terms.length) return "0";

  return terms.map(({ coefficient, variable }, index) => {
    const absolute = Math.abs(coefficient);
    const value = absolute === 1 ? variable : `${absolute} ${variable}`;
    if (index === 0) return coefficient < 0 ? `- ${value}` : value;
    return coefficient < 0 ? `- ${value}` : `+ ${value}`;
  }).join(" ");
}

function positiveTerms(variableNames) {
  return variableNames.map((variable) => ({ coefficient: 1, variable }));
}

/**
 * H1〜H12だけを含む実行可能性判定用のCPLEX LPモデルを構築する。
 * IndexedDBには触れない純粋関数なので、フィクスチャを渡して単体検証できる。
 */
export function buildModel(targetMonth, data = {}) {
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
  const shiftCodes = workShifts.map((shift) => String(shift.shift_code));
  const employeeIds = new Set(employees.map((employee) => String(employee.employee_id)));
  const validDays = new Set(days);
  const shiftCodeSet = new Set(shiftCodes);

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
        variableLookup.set(
          requirementKey(personDayKey(metadata.employee_id, date), metadata.shift_code),
          name,
        );
      });
    });
  });

  const variableFor = (employeeId, date, shiftCode) => variableLookup.get(
    requirementKey(personDayKey(String(employeeId), date), String(shiftCode)),
  );
  const variablesForDay = (employeeId, date) => shiftCodes.map(
    (shiftCode) => variableFor(employeeId, date, shiftCode),
  ).filter(Boolean);

  const constraints = [];
  const counts = Object.fromEntries(
    Array.from({ length: 12 }, (_, index) => [`H${index + 1}`, 0]),
  );
  const addConstraint = (group, name, terms, operator, rightHandSide) => {
    constraints.push(` ${name}: ${formatTerms(terms)} ${operator} ${rightHandSide}`);
    counts[group] += 1;
  };

  // H1: 各職員は1日につき高々1勤務。
  employees.forEach((employee, employeeIndex) => {
    days.forEach((date, dayIndex) => {
      addConstraint(
        "H1",
        `h1_e${employeeIndex}_d${dayIndex}`,
        positiveTerms(variablesForDay(employee.employee_id, date)),
        "<=",
        1,
      );
    });
  });

  // H2: 夜勤不可の職員はN勤務に入れない。
  const nightShiftIndex = shiftCodes.indexOf("N");
  if (nightShiftIndex >= 0) {
    employees.forEach((employee, employeeIndex) => {
      if (Boolean(employee.night_allowed)) return;
      days.forEach((date, dayIndex) => {
        addConstraint(
          "H2",
          `h2_e${employeeIndex}_d${dayIndex}`,
          positiveTerms([variableFor(employee.employee_id, date, "N")]),
          "=",
          0,
        );
      });
    });
  }

  // H3: 未登録の組み合わせを0人として、全日×全勤務区分を厳密一致させる。
  const requirementMap = new Map();
  for (const row of requirements) {
    requirementMap.set(
      requirementKey(String(row.date), String(row.shift_code)),
      integer(row.required_count),
    );
  }
  days.forEach((date, dayIndex) => {
    shiftCodes.forEach((shiftCode, shiftIndex) => {
      const names = employees.map(
        (employee) => variableFor(employee.employee_id, date, shiftCode),
      ).filter(Boolean);
      addConstraint(
        "H3",
        `h3_d${dayIndex}_c${shiftIndex}`,
        positiveTerms(names),
        "=",
        requirementMap.get(requirementKey(date, shiftCode)) ?? 0,
      );
    });
  });

  // H4: 月間勤務日数の下限・上限。
  employees.forEach((employee, employeeIndex) => {
    const names = days.flatMap((date) => variablesForDay(employee.employee_id, date));
    addConstraint(
      "H4",
      `h4_min_e${employeeIndex}`,
      positiveTerms(names),
      ">=",
      integer(employee.min_work_days),
    );
    addConstraint(
      "H4",
      `h4_max_e${employeeIndex}`,
      positiveTerms(names),
      "<=",
      Math.min(integer(employee.max_work_days, days.length), days.length),
    );
  });

  // H5: k+1日の各窓で勤務日をk日以下にする。
  employees.forEach((employee, employeeIndex) => {
    const maximum = Math.max(1, integer(employee.max_consecutive_days, 1));
    for (let start = 0; start < days.length - maximum; start += 1) {
      const names = days.slice(start, start + maximum + 1).flatMap(
        (date) => variablesForDay(employee.employee_id, date),
      );
      addConstraint(
        "H5",
        `h5_e${employeeIndex}_w${start}`,
        positiveTerms(names),
        "<=",
        maximum,
      );
    }
  });

  // H6: 翌日休養が必要な勤務の次の日は勤務させない。
  const restShiftIndexes = workShifts
    .map((shift, index) => (Boolean(shift.requires_rest_next_day) ? index : -1))
    .filter((index) => index >= 0);
  employees.forEach((employee, employeeIndex) => {
    days.slice(0, -1).forEach((date, dayIndex) => {
      restShiftIndexes.forEach((shiftIndex) => {
        const restCode = shiftCodes[shiftIndex];
        const terms = positiveTerms(variablesForDay(employee.employee_id, days[dayIndex + 1]));
        terms.push({
          coefficient: 1,
          variable: variableFor(employee.employee_id, date, restCode),
        });
        addConstraint(
          "H6",
          `h6_e${employeeIndex}_d${dayIndex}_c${shiftIndex}`,
          terms,
          "<=",
          1,
        );
      });
    });
  });

  // H7/H8: hardの休み・勤務指定。Python版同様、fixedのOも休みとして扱う。
  requests.forEach((request, requestIndex) => {
    const employeeId = String(request.employee_id);
    const date = String(request.date);
    const shiftCode = String(request.shift_code || "O");
    if (
      request.priority !== "hard"
      || !employeeIds.has(employeeId)
      || !validDays.has(date)
    ) {
      return;
    }
    if (request.request_type === "off" || shiftCode === "O") {
      addConstraint(
        "H7",
        `h7_r${requestIndex}`,
        positiveTerms(variablesForDay(employeeId, date)),
        "=",
        0,
      );
    } else if (request.request_type === "fixed" && shiftCodeSet.has(shiftCode)) {
      addConstraint(
        "H8",
        `h8_r${requestIndex}`,
        positiveTerms([variableFor(employeeId, date, shiftCode)]),
        "=",
        1,
      );
    }
  });

  if (Boolean(settings.restaurant_mode)) {
    // H9: E勤務がある日は開店担当者を1名以上配置する。
    const earlyShiftIndex = shiftCodes.indexOf("E");
    if (earlyShiftIndex >= 0) {
      const openers = employees.filter((employee) => employeeHasRole(employee, "opener"));
      days.forEach((date, dayIndex) => {
        if ((requirementMap.get(requirementKey(date, "E")) ?? 0) < 1) return;
        addConstraint(
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

    // H10: L勤務がある日は閉店担当者を1名以上配置する。
    const lateShiftIndex = shiftCodes.indexOf("L");
    if (lateShiftIndex >= 0) {
      const closers = employees.filter((employee) => employeeHasRole(employee, "closer"));
      days.forEach((date, dayIndex) => {
        if ((requirementMap.get(requirementKey(date, "L")) ?? 0) < 1) return;
        addConstraint(
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

    // H11: hardの同時配置禁止は「同じ日・同じ勤務区分」だけに適用する。
    staffRelations.forEach((relation, relationIndex) => {
      const employeeId1 = String(relation.employee_id_1);
      const employeeId2 = String(relation.employee_id_2);
      if (
        !Boolean(relation.active)
        || relation.relation_type !== "never_together"
        || relation.priority !== "hard"
        || !employeeIds.has(employeeId1)
        || !employeeIds.has(employeeId2)
      ) {
        return;
      }
      days.forEach((date, dayIndex) => {
        shiftCodes.forEach((shiftCode, shiftIndex) => {
          addConstraint(
            "H11",
            `h11_r${relationIndex}_d${dayIndex}_c${shiftIndex}`,
            positiveTerms([
              variableFor(employeeId1, date, shiftCode),
              variableFor(employeeId2, date, shiftCode),
            ]),
            "<=",
            1,
          );
        });
      });
    });

    // H12: 必要人数がある勤務を新人だけで構成しない。
    const newcomers = employees.filter((employee) => Boolean(employee.is_new_staff));
    const experienced = employees.filter((employee) => !Boolean(employee.is_new_staff));
    if (newcomers.length) {
      days.forEach((date, dayIndex) => {
        shiftCodes.forEach((shiftCode, shiftIndex) => {
          if ((requirementMap.get(requirementKey(date, shiftCode)) ?? 0) < 1) return;
          const terms = newcomers.map((employee) => ({
            coefficient: 1,
            variable: variableFor(employee.employee_id, date, shiftCode),
          }));
          terms.push(...experienced.map((employee) => ({
            coefficient: -newcomers.length,
            variable: variableFor(employee.employee_id, date, shiftCode),
          })));
          addConstraint(
            "H12",
            `h12_d${dayIndex}_c${shiftIndex}`,
            terms,
            "<=",
            0,
          );
        });
      });
    }
  }

  const lines = [
    "Minimize",
    ` obj: ${variables.length ? variables.map(({ name }) => `0 ${name}`).join(" + ") : "0"}`,
    "Subject To",
    ...constraints,
    "Binary",
    ...variables.map(({ name }) => ` ${name}`),
    "End",
  ];

  return {
    targetMonth,
    lpString: lines.join("\n"),
    variables,
    variableMap,
    days,
    shiftCodes,
    employeeIds: employees.map((employee) => String(employee.employee_id)),
    stats: {
      variableCount: variables.length,
      constraintCount: constraints.length,
      constraintsByGroup: counts,
    },
  };
}
