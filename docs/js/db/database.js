export const DATABASE_NAME = "shift-scheduler";
export const DATABASE_VERSION = 1;

export const STORE_NAMES = Object.freeze([
  "employees",
  "shift_types",
  "requirements",
  "requests",
  "schedules",
  "staff_relations",
  "business_days",
  "role_requirements",
  "product_campaigns",
  "settings",
]);

export const INITIAL_SHIFT_TYPES = Object.freeze([
  {
    shift_code: "D",
    shift_name: "日勤",
    is_work: 1,
    start_time: "09:00",
    end_time: "18:00",
    requires_rest_next_day: 0,
    color: "DCE9FF",
    note: "",
  },
  {
    shift_code: "E",
    shift_name: "早番",
    is_work: 1,
    start_time: "07:00",
    end_time: "16:00",
    requires_rest_next_day: 0,
    color: "DDF4E4",
    note: "",
  },
  {
    shift_code: "L",
    shift_name: "遅番",
    is_work: 1,
    start_time: "12:00",
    end_time: "21:00",
    requires_rest_next_day: 0,
    color: "FFE8CC",
    note: "",
  },
  {
    shift_code: "N",
    shift_name: "夜勤",
    is_work: 1,
    start_time: "21:00",
    end_time: "07:00",
    requires_rest_next_day: 1,
    color: "E8DDF8",
    note: "翌日は休み",
  },
  {
    shift_code: "O",
    shift_name: "休み",
    is_work: 0,
    start_time: "",
    end_time: "",
    requires_rest_next_day: 0,
    color: "E9ECEF",
    note: "",
  },
]);

export const STORE_SKILL_CODES = Object.freeze([
  "english_support",
  "cashier",
  "opener",
  "closer",
  "product_skill_ice",
  "product_skill_chocolate",
  "product_skill_cookie",
  "new_product",
  "allergy_support",
  "complaint_support",
  "new_staff",
  "trainer",
  "cash_manager",
  "hygiene_checker",
  "peak_support",
]);

export function createDefaultSettings() {
  const skills = Object.fromEntries(
    STORE_SKILL_CODES.map((skillCode) => [
      skillCode,
      {
        minimum_level: skillCode === "english_support" ? "basic" : "1",
        required_count: 0,
        priority: "soft",
      },
    ]),
  );

  return {
    id: 1,
    store_name: "店舗A",
    business_hours: "10:00-21:00",
    weekday_required: 0,
    weekend_required: 0,
    restaurant_mode: false,
    require_english_per_shift: false,
    requirement_template: {},
    skills,
  };
}

let databasePromise;

function getOrCreateStore(database, transaction, name, options) {
  if (database.objectStoreNames.contains(name)) {
    return transaction.objectStore(name);
  }
  return database.createObjectStore(name, options);
}

function createIndex(store, name, keyPath, options = {}) {
  if (store && !store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, options);
  }
}

function createSchema(database, transaction) {
  const employees = getOrCreateStore(
    database,
    transaction,
    "employees",
    { keyPath: "employee_id" },
  );
  createIndex(employees, "by_active", "active");

  getOrCreateStore(database, transaction, "shift_types", {
    keyPath: "shift_code",
  });

  const requirements = getOrCreateStore(database, transaction, "requirements", {
    keyPath: "id",
    autoIncrement: true,
  });
  createIndex(requirements, "by_month", "target_month");
  createIndex(
    requirements,
    "by_month_date_shift",
    ["target_month", "date", "shift_code"],
    { unique: true },
  );

  const requests = getOrCreateStore(database, transaction, "requests", {
    keyPath: "id",
    autoIncrement: true,
  });
  createIndex(requests, "by_month", "target_month");
  createIndex(requests, "by_employee", "employee_id");

  const schedules = getOrCreateStore(database, transaction, "schedules", {
    keyPath: "schedule_id",
    autoIncrement: true,
  });
  createIndex(schedules, "by_month", "target_month");

  const staffRelations = getOrCreateStore(database, transaction, "staff_relations", {
    keyPath: "id",
    autoIncrement: true,
  });
  createIndex(staffRelations, "by_employee_1", "employee_id_1");
  createIndex(staffRelations, "by_employee_2", "employee_id_2");

  const businessDays = getOrCreateStore(database, transaction, "business_days", {
    keyPath: "id",
    autoIncrement: true,
  });
  createIndex(businessDays, "by_month", "target_month");
  createIndex(businessDays, "by_date", "date", { unique: true });

  const roleRequirements = getOrCreateStore(
    database,
    transaction,
    "role_requirements",
    {
    keyPath: "id",
    autoIncrement: true,
    },
  );
  createIndex(roleRequirements, "by_month", "target_month");
  createIndex(
    roleRequirements,
    "by_month_date_shift_role",
    ["target_month", "date", "shift_code", "role_code"],
    { unique: true },
  );

  getOrCreateStore(database, transaction, "product_campaigns", {
    keyPath: "id",
    autoIncrement: true,
  });
  getOrCreateStore(database, transaction, "settings", { keyPath: "id" });
}

function seedInitialData(transaction) {
  const shiftTypes = transaction.objectStore("shift_types");
  for (const shiftType of INITIAL_SHIFT_TYPES) {
    shiftTypes.add({ ...shiftType });
  }
  transaction.objectStore("settings").add(createDefaultSettings());
}

export function openDatabase() {
  if (databasePromise) {
    return databasePromise;
  }

  databasePromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("このブラウザはIndexedDBに対応していません。"));
      return;
    }

    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = (event) => {
      const database = request.result;
      const transaction = request.transaction;
      createSchema(database, transaction);
      if (event.oldVersion < 1) {
        seedInitialData(transaction);
      }
    };

    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = undefined;
      };
      resolve(database);
    };

    request.onerror = () => {
      databasePromise = undefined;
      reject(request.error ?? new Error("データベースを開けませんでした。"));
    };

    request.onblocked = () => {
      console.warn("データベース更新のため、別のタブを閉じてください。");
    };
  });

  return databasePromise;
}
