import type { SQLiteDatabase } from 'expo-sqlite';

export const DATABASE_VERSION = 46;

type TableColumn = { name: string };

async function addColumnIfMissing(db: SQLiteDatabase, table: string, column: string, definition: string): Promise<void> {
  const getAllAsync = (db as SQLiteDatabase & {getAllAsync?: <T>(sql: string) => Promise<T[]>}).getAllAsync;
  if (typeof getAllAsync === 'function') {
    const columns = await getAllAsync.call(db, `PRAGMA table_info(${table})`) as TableColumn[];
    if (columns.some(value => value.name === column)) return;
  }
  await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
}

function sqlText(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Frozen, migration-local normalization for the version 34 -> 35 consulting-agencies seed step
 * (DEC-417). This is a deliberate, intentional duplicate of the logic in
 * domain/profiles.ts's normalizeAgencyName/normalizeAgencyKey, not a shared import: a migration
 * must keep producing the exact same result every time it ever runs, against a database captured
 * at any point in the app's history, regardless of how the live domain logic is later refactored.
 * If normalizeAgencyName/normalizeAgencyKey ever change, this pair must NOT be changed to match --
 * doing so would silently alter what migration 35 does to an old version-34 database. The runtime
 * repository (SqliteProfileRepository) uses the real domain helpers for every agency it creates or
 * edits after this migration has run; only this one historical seeding step uses the frozen copy.
 */
// Exported so a test can assert this frozen copy currently agrees with the live domain
// normalization, without the migration module itself importing or depending on that domain code.
export function migration35NormalizeAgencyName(nameEn: string): string {
  return nameEn.trim().replace(/\s+/g, ' ');
}
export function migration35NormalizeAgencyKey(nameEn: string): string {
  return migration35NormalizeAgencyName(nameEn).toLocaleLowerCase('en-US');
}

export const RESERVED_TEST_DATA_DEACTIVATION_SQL = `
  UPDATE projects SET status = 'completed'
    WHERE id LIKE 'slice8_test_%' OR id LIKE 'slice11_test_%' OR id LIKE 'demo_linked_%' OR id LIKE 'test_report_project_%';
  UPDATE worker_profiles SET is_active = 0 WHERE id LIKE 'slice8_test_%' OR id LIKE 'slice11_test_%' OR id LIKE 'demo_linked_%';
  UPDATE machine_profiles SET is_active = 0 WHERE id LIKE 'slice8_test_%' OR id LIKE 'slice11_test_%' OR id LIKE 'demo_linked_%';
  UPDATE driver_profiles SET is_active = 0 WHERE id LIKE 'slice8_test_%' OR id LIKE 'slice11_test_%' OR id LIKE 'demo_linked_%';
  UPDATE truck_profiles SET is_active = 0 WHERE id LIKE 'slice8_test_%' OR id LIKE 'slice11_test_%' OR id LIKE 'demo_linked_%';
  UPDATE catalog_items SET is_active = 0 WHERE id LIKE 'slice8_test_%' OR id LIKE 'slice11_test_%' OR id LIKE 'demo_linked_%' OR id LIKE 'test_filter_item_%';
  UPDATE categories SET is_active = 0 WHERE id LIKE 'slice8_test_%' OR id LIKE 'slice11_test_%' OR id LIKE 'demo_linked_%' OR id = 'test_filter_category';
  UPDATE suppliers SET is_active = 0 WHERE id LIKE 'slice8_test_%' OR id LIKE 'slice11_test_%' OR id LIKE 'demo_linked_%';
  UPDATE customers SET is_active = 0
    WHERE is_own_company = 0 AND (id LIKE 'slice8_test_%' OR id LIKE 'slice11_test_%' OR id LIKE 'demo_linked_%' OR id IN ('test_filter_customer','test_report_customer'));
`;

export async function migrateDatabase(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let currentVersion = row?.user_version ?? 0;

  if (currentVersion >= DATABASE_VERSION) return;

  if (currentVersion === 0) {
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE categories (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE catalog_items (
        id TEXT PRIMARY KEY NOT NULL,
        category_id TEXT NOT NULL REFERENCES categories(id),
        name TEXT NOT NULL,
        internal_code TEXT COLLATE NOCASE UNIQUE,
        description TEXT,
        default_unit_id TEXT,
        default_receipt_price_usd_cents INTEGER CHECK (
          default_receipt_price_usd_cents IS NULL OR default_receipt_price_usd_cents >= 0
        ),
        loads_enabled INTEGER NOT NULL DEFAULT 0 CHECK (loads_enabled IN (0, 1)),
        quarry_enabled INTEGER NOT NULL DEFAULT 0 CHECK (quarry_enabled IN (0, 1)),
        daily_reports_enabled INTEGER NOT NULL DEFAULT 0 CHECK (daily_reports_enabled IN (0, 1)),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (loads_enabled + quarry_enabled + daily_reports_enabled >= 1)
      );

      CREATE INDEX idx_catalog_items_category ON catalog_items(category_id);
      CREATE INDEX idx_catalog_items_active_name ON catalog_items(is_active, name COLLATE NOCASE);

      CREATE TABLE sync_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
      );
    `);
    currentVersion = 1;
  }

  if (currentVersion === 1) {
    await db.execAsync(`
      CREATE TABLE customers (
        id TEXT PRIMARY KEY NOT NULL,
        customer_type TEXT NOT NULL CHECK (customer_type IN ('individual', 'company')),
        name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        address TEXT,
        tax_vat_number TEXT,
        notes TEXT,
        is_own_company INTEGER NOT NULL DEFAULT 0 CHECK (is_own_company IN (0, 1)),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        merged_into_id TEXT REFERENCES customers(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX idx_customers_active_name
        ON customers(is_active, name COLLATE NOCASE);
      CREATE INDEX idx_customers_phone ON customers(phone);
      CREATE INDEX idx_customers_tax_vat ON customers(tax_vat_number COLLATE NOCASE);
      CREATE UNIQUE INDEX idx_customers_one_own_company
        ON customers(is_own_company) WHERE is_own_company = 1;

      CREATE TABLE company_settings (
        id TEXT PRIMARY KEY NOT NULL CHECK (id = 'company'),
        company_name TEXT NOT NULL,
        logo_uri TEXT,
        address TEXT,
        phone TEXT,
        email TEXT,
        tax_vat_number TEXT,
        receipt_footer TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE tax_settings (
        id TEXT PRIMARY KEY NOT NULL CHECK (id = 'tax'),
        vat_rate_basis_points INTEGER NOT NULL DEFAULT 0
          CHECK (vat_rate_basis_points BETWEEN 0 AND 10000),
        updated_at TEXT NOT NULL
      );
    `);
    currentVersion = 2;
  }

  if (currentVersion === 2) {
    const now = new Date().toISOString();
    const deviceCode = Math.random().toString(36).slice(2, 6).toUpperCase();
    await db.execAsync(`
      CREATE TABLE measurement_units (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        symbol TEXT NOT NULL COLLATE NOCASE UNIQUE,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE conversion_options (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        input_unit_id TEXT NOT NULL REFERENCES measurement_units(id),
        output_unit_id TEXT NOT NULL REFERENCES measurement_units(id),
        input_quantity REAL NOT NULL CHECK (input_quantity > 0),
        output_quantity REAL NOT NULL CHECK (output_quantity > 0),
        decimal_places INTEGER NOT NULL CHECK (decimal_places BETWEEN 0 AND 6),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE projects (
        id TEXT PRIMARY KEY NOT NULL,
        customer_id TEXT NOT NULL REFERENCES customers(id),
        name TEXT NOT NULL,
        location TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
        start_date TEXT,
        end_date TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_projects_customer_status ON projects(customer_id, status, name COLLATE NOCASE);

      CREATE TABLE load_drafts (
        id TEXT PRIMARY KEY NOT NULL CHECK (id = 'current'),
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE device_state (
        id TEXT PRIMARY KEY NOT NULL CHECK (id = 'local'),
        device_code TEXT NOT NULL,
        next_load_sequence INTEGER NOT NULL CHECK (next_load_sequence > 0)
      );
      INSERT INTO device_state (id, device_code, next_load_sequence) VALUES ('local', '${deviceCode}', 1);

      CREATE TABLE loads (
        id TEXT PRIMARY KEY NOT NULL,
        transaction_number TEXT NOT NULL UNIQUE,
        confirmed_at TEXT NOT NULL,
        customer_id TEXT NOT NULL REFERENCES customers(id),
        customer_name TEXT NOT NULL,
        project_id TEXT REFERENCES projects(id),
        project_name TEXT,
        project_location TEXT,
        destination_address TEXT,
        item_id TEXT NOT NULL REFERENCES catalog_items(id),
        item_name TEXT NOT NULL,
        item_code TEXT,
        category_name TEXT NOT NULL,
        driver_name TEXT NOT NULL,
        truck_plate TEXT NOT NULL,
        requested_quantity_kg INTEGER,
        empty_weight_kg INTEGER NOT NULL,
        full_weight_kg INTEGER NOT NULL,
        net_weight_kg INTEGER NOT NULL,
        conversion_id TEXT NOT NULL REFERENCES conversion_options(id),
        conversion_name TEXT NOT NULL,
        conversion_rule TEXT NOT NULL,
        output_unit_symbol TEXT NOT NULL,
        converted_quantity REAL NOT NULL,
        billed_quantity REAL NOT NULL,
        unit_price_usd_cents INTEGER,
        subtotal_usd_cents INTEGER,
        vat_rate_basis_points INTEGER,
        vat_amount_usd_cents INTEGER,
        final_total_usd_cents INTEGER,
        payment_status TEXT NOT NULL CHECK (payment_status IN ('Unpriced', 'No Payment Due', 'Unpaid', 'Partially Paid', 'Paid', 'Overpaid')),
        signature_status TEXT NOT NULL DEFAULT 'Unsigned' CHECK (signature_status IN ('Unsigned', 'Signed')),
        notes TEXT,
        company_name TEXT NOT NULL,
        company_address TEXT,
        company_phone TEXT,
        company_email TEXT,
        company_tax_vat_number TEXT,
        company_receipt_footer TEXT,
        CHECK (full_weight_kg > empty_weight_kg),
        CHECK (net_weight_kg = full_weight_kg - empty_weight_kg)
      );
      CREATE INDEX idx_loads_confirmed_at ON loads(confirmed_at DESC);
      CREATE INDEX idx_loads_customer ON loads(customer_id, confirmed_at DESC);

      INSERT INTO measurement_units (id, name, symbol, created_at, updated_at)
        VALUES ('unit_kg', 'Kilogram', 'kg', '${now}', '${now}');
      INSERT INTO measurement_units (id, name, symbol, created_at, updated_at)
        VALUES ('unit_ton', 'Metric ton', 't', '${now}', '${now}');
      INSERT INTO conversion_options (
        id, name, input_unit_id, output_unit_id, input_quantity, output_quantity,
        decimal_places, created_at, updated_at
      ) VALUES ('conversion_kg_ton', 'Kilograms to metric tons', 'unit_kg', 'unit_ton',
        1000, 1, 3, '${now}', '${now}');
    `);
    currentVersion = 3;
  }

  if (currentVersion === 3) {
    await db.execAsync(`
      CREATE TABLE driver_profiles (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        phone TEXT,
        license_number TEXT,
        notes TEXT,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_driver_profiles_active_name ON driver_profiles(is_active, name COLLATE NOCASE);

      CREATE TABLE truck_profiles (
        id TEXT PRIMARY KEY NOT NULL,
        plate TEXT NOT NULL COLLATE NOCASE UNIQUE,
        make_model TEXT,
        capacity_kg INTEGER CHECK (capacity_kg IS NULL OR capacity_kg > 0),
        owner_name TEXT,
        notes TEXT,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_truck_profiles_active_plate ON truck_profiles(is_active, plate COLLATE NOCASE);

      ALTER TABLE loads ADD COLUMN driver_profile_id TEXT REFERENCES driver_profiles(id);
      ALTER TABLE loads ADD COLUMN truck_profile_id TEXT REFERENCES truck_profiles(id);
    `);
    currentVersion = 4;
  }

  if (currentVersion === 4) {
    await db.execAsync(`
      CREATE TABLE daily_project_reports (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id),
        work_date TEXT NOT NULL,
        work_description TEXT NOT NULL,
        workers_json TEXT NOT NULL DEFAULT '[]',
        drivers_json TEXT NOT NULL DEFAULT '[]',
        truck_plates_json TEXT NOT NULL DEFAULT '[]',
        machines_json TEXT NOT NULL DEFAULT '[]',
        materials_json TEXT NOT NULL DEFAULT '[]',
        notes TEXT,
        problems_delays_incidents TEXT,
        weather_site_conditions TEXT,
        work_start_time TEXT,
        work_end_time TEXT,
        break_minutes INTEGER CHECK (break_minutes IS NULL OR break_minutes >= 0),
        next_work_planned TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, work_date)
      );
      CREATE INDEX idx_daily_reports_project_date
        ON daily_project_reports(project_id, work_date DESC);
    `);
    currentVersion = 5;
  }

  if (currentVersion === 5) {
    await db.execAsync(`
      CREATE TABLE suppliers (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        address TEXT,
        tax_vat_number TEXT,
        notes TEXT,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_suppliers_active_name ON suppliers(is_active, name COLLATE NOCASE);

      CREATE TABLE quarry_purchases (
        id TEXT PRIMARY KEY NOT NULL,
        purchase_number TEXT NOT NULL UNIQUE,
        confirmed_at TEXT NOT NULL,
        supplier_id TEXT NOT NULL REFERENCES suppliers(id),
        supplier_name TEXT NOT NULL,
        item_id TEXT NOT NULL REFERENCES catalog_items(id),
        item_name TEXT NOT NULL,
        item_code TEXT,
        category_name TEXT NOT NULL,
        quantity_cubic_metres INTEGER NOT NULL CHECK (quantity_cubic_metres > 0),
        driver_profile_id TEXT NOT NULL REFERENCES driver_profiles(id),
        driver_name TEXT NOT NULL,
        truck_profile_id TEXT NOT NULL REFERENCES truck_profiles(id),
        truck_plate TEXT NOT NULL,
        supplier_ticket_number TEXT,
        unit_price_usd_cents INTEGER CHECK (unit_price_usd_cents IS NULL OR unit_price_usd_cents >= 0),
        subtotal_usd_cents INTEGER,
        vat_rate_basis_points INTEGER,
        vat_amount_usd_cents INTEGER,
        final_total_usd_cents INTEGER,
        payment_status TEXT NOT NULL CHECK (payment_status IN ('Unpriced', 'No Payment Due', 'Unpaid', 'Partially Paid', 'Paid', 'Overpaid')),
        notes TEXT
      );
      CREATE INDEX idx_quarry_purchases_confirmed_at ON quarry_purchases(confirmed_at DESC);
      CREATE INDEX idx_quarry_purchases_supplier ON quarry_purchases(supplier_id, confirmed_at DESC);
      ALTER TABLE device_state ADD COLUMN next_quarry_sequence INTEGER NOT NULL DEFAULT 1 CHECK (next_quarry_sequence > 0);
    `);
    currentVersion = 6;
  }

  if (currentVersion === 6) {
    await db.execAsync(`
      ALTER TABLE loads ADD COLUMN signature_json TEXT;
      ALTER TABLE loads ADD COLUMN company_logo_uri TEXT;
      ALTER TABLE daily_project_reports ADD COLUMN photos_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE quarry_purchases ADD COLUMN photos_json TEXT NOT NULL DEFAULT '[]';
    `);
    currentVersion = 7;
  }

  if (currentVersion === 7) {
    await db.execAsync(`
      CREATE TABLE worker_profiles (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        role TEXT,
        phone TEXT,
        notes TEXT,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_worker_profiles_active_name ON worker_profiles(is_active, name COLLATE NOCASE);

      CREATE TABLE machine_profiles (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        machine_type TEXT,
        identifier TEXT COLLATE NOCASE UNIQUE,
        notes TEXT,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_machine_profiles_active_name ON machine_profiles(is_active, name COLLATE NOCASE);
    `);
    currentVersion = 8;
  }

  if (currentVersion === 8) {
    await db.execAsync(`
      CREATE TABLE opening_balances (
        id TEXT PRIMARY KEY NOT NULL,
        party_type TEXT NOT NULL CHECK (party_type IN ('customer', 'supplier')),
        customer_id TEXT REFERENCES customers(id),
        supplier_id TEXT REFERENCES suppliers(id),
        party_name TEXT NOT NULL,
        original_amount_usd_cents INTEGER NOT NULL CHECK (original_amount_usd_cents > 0),
        as_of_date TEXT NOT NULL,
        reference TEXT,
        notes TEXT,
        payment_status TEXT NOT NULL DEFAULT 'Unpaid' CHECK (payment_status IN ('Unpaid', 'Partially Paid', 'Paid', 'Overpaid')),
        created_at TEXT NOT NULL,
        CHECK ((party_type = 'customer' AND customer_id IS NOT NULL AND supplier_id IS NULL) OR (party_type = 'supplier' AND supplier_id IS NOT NULL AND customer_id IS NULL))
      );
      CREATE INDEX idx_opening_balances_customer ON opening_balances(customer_id, as_of_date DESC);
      CREATE INDEX idx_opening_balances_supplier ON opening_balances(supplier_id, as_of_date DESC);

      CREATE TABLE payment_entries (
        id TEXT PRIMARY KEY NOT NULL,
        target_type TEXT NOT NULL CHECK (target_type IN ('load', 'quarryPurchase', 'openingBalance')),
        load_id TEXT REFERENCES loads(id),
        quarry_purchase_id TEXT REFERENCES quarry_purchases(id),
        opening_balance_id TEXT REFERENCES opening_balances(id),
        amount_usd_cents INTEGER NOT NULL CHECK (amount_usd_cents > 0),
        payment_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Cancelled')),
        cancellation_reason TEXT,
        cancelled_at TEXT,
        created_at TEXT NOT NULL,
        CHECK ((target_type = 'load' AND load_id IS NOT NULL AND quarry_purchase_id IS NULL AND opening_balance_id IS NULL) OR (target_type = 'quarryPurchase' AND load_id IS NULL AND quarry_purchase_id IS NOT NULL AND opening_balance_id IS NULL) OR (target_type = 'openingBalance' AND load_id IS NULL AND quarry_purchase_id IS NULL AND opening_balance_id IS NOT NULL))
      );
      CREATE INDEX idx_payments_load ON payment_entries(load_id, payment_date DESC);
      CREATE INDEX idx_payments_quarry ON payment_entries(quarry_purchase_id, payment_date DESC);
      CREATE INDEX idx_payments_opening ON payment_entries(opening_balance_id, payment_date DESC);
    `);
    currentVersion = 9;
  }

  if (currentVersion === 9) {
    await db.execAsync(`
      CREATE TABLE waste_dumps (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id),
        work_date TEXT NOT NULL,
        dumped_at TEXT NOT NULL,
        material_type TEXT,
        dump_location TEXT,
        truck_profile_id TEXT REFERENCES truck_profiles(id),
        truck_plate TEXT,
        driver_profile_id TEXT REFERENCES driver_profiles(id),
        driver_name TEXT,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Cancelled')),
        cancellation_reason TEXT,
        cancelled_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_waste_dumps_project_date ON waste_dumps(project_id, work_date DESC, dumped_at DESC);
      CREATE INDEX idx_waste_dumps_status ON waste_dumps(status, dumped_at DESC);
    `);
    currentVersion = 10;
  }

  if (currentVersion === 10) {
    await db.execAsync(`
      ALTER TABLE quarry_purchases ADD COLUMN status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Cancelled'));
      ALTER TABLE quarry_purchases ADD COLUMN cancellation_reason TEXT;
      ALTER TABLE quarry_purchases ADD COLUMN cancelled_at TEXT;
      CREATE INDEX idx_quarry_purchases_status ON quarry_purchases(status, confirmed_at DESC);
    `);
    currentVersion = 11;
  }

  if (currentVersion === 11) {
    await db.execAsync(`
      ALTER TABLE device_state ADD COLUMN next_quick_text_sequence INTEGER NOT NULL DEFAULT 1 CHECK (next_quick_text_sequence > 0);
      CREATE TABLE quick_text_documents (
        id TEXT PRIMARY KEY NOT NULL,
        document_number TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        title TEXT NOT NULL,
        reference TEXT,
        customer_id TEXT REFERENCES customers(id),
        customer_name TEXT,
        project_id TEXT REFERENCES projects(id),
        project_name TEXT,
        message TEXT NOT NULL,
        alignment TEXT NOT NULL CHECK (alignment IN ('left','center','right')),
        emphasis TEXT NOT NULL CHECK (emphasis IN ('normal','bold','notice')),
        prepared_by TEXT,
        show_signature_line INTEGER NOT NULL DEFAULT 0 CHECK (show_signature_line IN (0,1)),
        paper_width TEXT NOT NULL CHECK (paper_width IN ('58','80')),
        company_name TEXT NOT NULL,
        company_address TEXT,
        company_phone TEXT,
        company_email TEXT,
        company_tax_vat_number TEXT,
        company_receipt_footer TEXT,
        company_logo_uri TEXT
      );
      CREATE INDEX idx_quick_text_created_at ON quick_text_documents(created_at DESC);
    `);
    currentVersion = 12;
  }

  if (currentVersion === 12) {
    await db.execAsync(`
      CREATE TABLE fuel_movements (
        id TEXT PRIMARY KEY NOT NULL,
        movement_type TEXT NOT NULL CHECK (movement_type IN ('gauge','delivery','fill')),
        confirmed_at TEXT NOT NULL,
        litres REAL NOT NULL CHECK (litres >= 0),
        previous_balance_litres REAL,
        difference_litres REAL,
        supplier_id TEXT REFERENCES suppliers(id),
        supplier_name TEXT,
        equipment_id TEXT REFERENCES machine_profiles(id),
        equipment_name TEXT,
        project_id TEXT REFERENCES projects(id),
        project_name TEXT,
        ticket_number TEXT,
        odometer_reading TEXT,
        reason TEXT,
        notes TEXT,
        price_per_litre_usd_cents INTEGER CHECK (price_per_litre_usd_cents IS NULL OR price_per_litre_usd_cents >= 0),
        subtotal_usd_cents INTEGER,
        vat_rate_basis_points INTEGER,
        vat_amount_usd_cents INTEGER,
        final_total_usd_cents INTEGER,
        payment_status TEXT NOT NULL DEFAULT 'Unpriced' CHECK (payment_status IN ('Unpriced','No Payment Due','Unpaid','Partially Paid','Paid','Overpaid')),
        status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Cancelled')),
        cancellation_reason TEXT,
        cancelled_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_fuel_movements_time ON fuel_movements(confirmed_at DESC);
      CREATE INDEX idx_fuel_movements_equipment ON fuel_movements(equipment_id, confirmed_at DESC);
      CREATE INDEX idx_fuel_movements_supplier ON fuel_movements(supplier_id, confirmed_at DESC);

      CREATE TABLE payment_entries_v2 (
        id TEXT PRIMARY KEY NOT NULL,
        target_type TEXT NOT NULL CHECK (target_type IN ('load', 'quarryPurchase', 'openingBalance', 'fuelDelivery')),
        load_id TEXT REFERENCES loads(id),
        quarry_purchase_id TEXT REFERENCES quarry_purchases(id),
        opening_balance_id TEXT REFERENCES opening_balances(id),
        fuel_movement_id TEXT REFERENCES fuel_movements(id),
        amount_usd_cents INTEGER NOT NULL CHECK (amount_usd_cents > 0),
        payment_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Cancelled')),
        cancellation_reason TEXT,
        cancelled_at TEXT,
        created_at TEXT NOT NULL,
        CHECK (
          (target_type = 'load' AND load_id IS NOT NULL AND quarry_purchase_id IS NULL AND opening_balance_id IS NULL AND fuel_movement_id IS NULL) OR
          (target_type = 'quarryPurchase' AND load_id IS NULL AND quarry_purchase_id IS NOT NULL AND opening_balance_id IS NULL AND fuel_movement_id IS NULL) OR
          (target_type = 'openingBalance' AND load_id IS NULL AND quarry_purchase_id IS NULL AND opening_balance_id IS NOT NULL AND fuel_movement_id IS NULL) OR
          (target_type = 'fuelDelivery' AND load_id IS NULL AND quarry_purchase_id IS NULL AND opening_balance_id IS NULL AND fuel_movement_id IS NOT NULL)
        )
      );
      INSERT INTO payment_entries_v2 (id,target_type,load_id,quarry_purchase_id,opening_balance_id,amount_usd_cents,payment_date,status,cancellation_reason,cancelled_at,created_at)
        SELECT id,target_type,load_id,quarry_purchase_id,opening_balance_id,amount_usd_cents,payment_date,status,cancellation_reason,cancelled_at,created_at FROM payment_entries;
      DROP TABLE payment_entries;
      ALTER TABLE payment_entries_v2 RENAME TO payment_entries;
      CREATE INDEX idx_payments_load ON payment_entries(load_id, payment_date DESC);
      CREATE INDEX idx_payments_quarry ON payment_entries(quarry_purchase_id, payment_date DESC);
      CREATE INDEX idx_payments_opening ON payment_entries(opening_balance_id, payment_date DESC);
      CREATE INDEX idx_payments_fuel ON payment_entries(fuel_movement_id, payment_date DESC);
    `);
    currentVersion = 13;
  }

  if (currentVersion === 13) {
    await db.execAsync(`
      ALTER TABLE quarry_purchases ADD COLUMN project_id TEXT REFERENCES projects(id);
      ALTER TABLE quarry_purchases ADD COLUMN project_name TEXT;
      CREATE INDEX idx_quarry_purchases_project ON quarry_purchases(project_id, confirmed_at DESC);
    `);
    currentVersion = 14;
  }

  if (currentVersion === 14) {
    await db.execAsync(RESERVED_TEST_DATA_DEACTIVATION_SQL);
    currentVersion = 15;
  }

  if (currentVersion === 15) {
    await db.execAsync(`
      ALTER TABLE projects ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0,1));
      ALTER TABLE loads ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0,1));
      UPDATE projects SET is_archived = 1
        WHERE id LIKE 'slice8_test_%' OR id LIKE 'slice11_test_%' OR id LIKE 'demo_linked_%' OR id LIKE 'test_report_project_%';
      UPDATE loads SET is_archived = 1
        WHERE id LIKE 'slice8_test_%' OR id LIKE 'slice11_test_%' OR id LIKE 'demo_linked_%' OR id LIKE 'test_filter_load_%';
      CREATE INDEX idx_projects_archived ON projects(is_archived, status, name);
      CREATE INDEX idx_loads_archived_time ON loads(is_archived, confirmed_at DESC);
    `);
    currentVersion = 16;
  }

  if (currentVersion === 16) {
    await db.execAsync(`
      CREATE TABLE schedule_tasks (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id),
        title TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'Normal'
          CHECK (priority IN ('Low','Normal','High','Urgent')),
        status TEXT NOT NULL DEFAULT 'Planned'
          CHECK (status IN ('Planned','In Progress','Blocked','Completed')),
        responsible_person TEXT,
        location TEXT,
        notes TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (end_date >= start_date)
      );
      CREATE INDEX idx_schedule_tasks_project_date
        ON schedule_tasks(project_id, start_date, end_date);
      CREATE INDEX idx_schedule_tasks_status_date
        ON schedule_tasks(status, start_date, end_date);

      CREATE TABLE waste_counter_presets (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id),
        driver_profile_id TEXT NOT NULL REFERENCES driver_profiles(id),
        truck_profile_id TEXT NOT NULL REFERENCES truck_profiles(id),
        material_type TEXT,
        dump_location TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, driver_profile_id, truck_profile_id)
      );
      CREATE INDEX idx_waste_counter_presets_project
        ON waste_counter_presets(project_id, updated_at DESC);
    `);
    currentVersion = 17;
  }

  if (currentVersion === 17) {
    await db.execAsync(`
      CREATE TABLE project_issues (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id),
        title TEXT NOT NULL,
        description TEXT,
        priority TEXT NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Low','Normal','High','Urgent')),
        status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Resolved')),
        due_date TEXT,
        resolved_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_project_issues_project_status ON project_issues(project_id,status,priority,created_at DESC);
      CREATE TABLE project_media (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id),
        uri TEXT NOT NULL,
        caption TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_project_media_project_time ON project_media(project_id,created_at DESC);
    `);
    currentVersion = 18;
  }

  if (currentVersion === 18) {
    await db.execAsync(`
      CREATE TABLE cloud_sync_state (
        id TEXT PRIMARY KEY NOT NULL CHECK (id = 'cloud'),
        owner_uid TEXT,
        owner_email TEXT,
        device_id TEXT NOT NULL,
        last_sync_at TEXT,
        last_pull_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
        last_error TEXT,
        phase TEXT NOT NULL DEFAULT 'idle' CHECK (phase IN ('idle','syncing','offline','error')),
        initial_upload_complete INTEGER NOT NULL DEFAULT 0 CHECK (initial_upload_complete IN (0,1))
      );
      INSERT INTO cloud_sync_state (id,device_id)
        VALUES ('cloud',lower(hex(randomblob(12))));
      CREATE TABLE cloud_sync_records (
        record_key TEXT PRIMARY KEY NOT NULL,
        client_modified_at TEXT NOT NULL,
        cloud_updated_at TEXT NOT NULL,
        device_id TEXT NOT NULL
      );
      CREATE INDEX idx_cloud_sync_records_cloud_time
        ON cloud_sync_records(cloud_updated_at);
    `);
    currentVersion = 19;
  }

  if (currentVersion === 19) {
    await db.execAsync(`
      CREATE TABLE pavement_calculations (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id),
        name TEXT NOT NULL,
        length_m REAL,
        width_m REAL,
        area_m2 REAL NOT NULL CHECK (area_m2 > 0),
        spread_rate_kg_m2 REAL NOT NULL CHECK (spread_rate_kg_m2 > 0),
        density_t_m3 REAL NOT NULL CHECK (density_t_m3 > 0),
        allowance_percent REAL NOT NULL DEFAULT 0 CHECK (allowance_percent >= 0),
        theoretical_kg REAL NOT NULL CHECK (theoretical_kg > 0),
        allowance_kg REAL NOT NULL CHECK (allowance_kg >= 0),
        planned_kg REAL NOT NULL CHECK (planned_kg > 0),
        thickness_mm REAL NOT NULL CHECK (thickness_mm > 0),
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_pavement_calculations_project_time
        ON pavement_calculations(project_id, updated_at DESC);
    `);
    currentVersion = 20;
  }

  if (currentVersion === 20) {
    await db.execAsync(`
      ALTER TABLE pavement_calculations ADD COLUMN loose_thickness_factor REAL;
      ALTER TABLE pavement_calculations ADD COLUMN loose_thickness_mm REAL;
    `);
    currentVersion = 21;
  }

  if (currentVersion === 21) {
    await db.execAsync(`
      CREATE TABLE walls (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id),
        name TEXT NOT NULL,
        system TEXT NOT NULL CHECK (system IN ('reinforced_concrete','rubble_masonry','cyclopean_concrete')),
        purpose TEXT NOT NULL CHECK (purpose IN ('retaining','boundary','other')),
        length_m REAL NOT NULL CHECK (length_m > 0),
        height_m REAL NOT NULL CHECK (height_m > 0),
        bottom_thickness_m REAL NOT NULL CHECK (bottom_thickness_m > 0),
        top_thickness_m REAL NOT NULL CHECK (top_thickness_m > 0),
        deduction_m3 REAL NOT NULL DEFAULT 0 CHECK (deduction_m3 >= 0),
        allowance_percent REAL NOT NULL DEFAULT 0 CHECK (allowance_percent >= 0),
        net_volume_m3 REAL NOT NULL CHECK (net_volume_m3 > 0),
        planned_volume_m3 REAL NOT NULL CHECK (planned_volume_m3 > 0),
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_walls_project_time ON walls(project_id,updated_at DESC);
      CREATE TABLE wall_consumptions (
        id TEXT PRIMARY KEY NOT NULL,
        wall_id TEXT NOT NULL REFERENCES walls(id),
        used_on TEXT NOT NULL,
        material_type TEXT NOT NULL CHECK (material_type IN ('ready_mix','site_mix','rebar','stone')),
        concrete_purpose TEXT CHECK (concrete_purpose IN ('structural','filling','cyclopean_matrix','mortar','footing','coping')),
        finished_volume_m3 REAL,
        cement_bags REAL,
        cement_bag_kg REAL,
        sand_quantity REAL,
        sand_unit TEXT CHECK (sand_unit IN ('m3','tonnes')),
        gravel_quantity REAL,
        gravel_unit TEXT CHECK (gravel_unit IN ('m3','tonnes')),
        water_litres REAL,
        admixture_quantity REAL,
        admixture_unit TEXT CHECK (admixture_unit IN ('litres','kg')),
        stone_quantity REAL,
        stone_unit TEXT CHECK (stone_unit IN ('m3','tonnes')),
        rebar_diameter_mm REAL,
        rebar_count REAL,
        rebar_length_each_m REAL,
        total_rebar_length_m REAL,
        total_rebar_kg REAL,
        rebar_grade TEXT,
        notes TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_wall_consumptions_wall_date ON wall_consumptions(wall_id,used_on DESC,created_at DESC);
    `);
    currentVersion = 22;
  }

  if (currentVersion === 22) {
    const seededAt=new Date().toISOString();
    await db.execAsync(`
      ALTER TABLE loads ADD COLUMN quantity_method TEXT NOT NULL DEFAULT 'weighbridge'
        CHECK (quantity_method IN ('weighbridge','direct'));
      ALTER TABLE loads ADD COLUMN direct_quantity REAL;
      ALTER TABLE loads ADD COLUMN direct_unit_id TEXT REFERENCES measurement_units(id);
      ALTER TABLE loads ADD COLUMN direct_unit_name TEXT;
      ALTER TABLE loads ADD COLUMN direct_unit_symbol TEXT;
      INSERT OR IGNORE INTO measurement_units (id,name,symbol,created_at,updated_at) VALUES ('unit_piece','Piece','pc','${seededAt}','${seededAt}');
      INSERT OR IGNORE INTO measurement_units (id,name,symbol,created_at,updated_at) VALUES ('unit_metre','Metre','m','${seededAt}','${seededAt}');
      INSERT OR IGNORE INTO measurement_units (id,name,symbol,created_at,updated_at) VALUES ('unit_bundle','Bundle','bundle','${seededAt}','${seededAt}');
    `);
    currentVersion = 23;
  }

  if (currentVersion === 23) {
    const seededAt=new Date().toISOString();
    await db.execAsync(`
      ALTER TABLE quarry_purchases ADD COLUMN delivery_method TEXT NOT NULL DEFAULT 'company'
        CHECK (delivery_method IN ('company','supplier'));
      INSERT OR IGNORE INTO driver_profiles (id,name,notes,is_active,created_at,updated_at)
        VALUES ('system_supplier_delivery_driver','Supplier Delivering','Internal compatibility record; hidden from active driver lists.',0,'${seededAt}','${seededAt}');
      INSERT OR IGNORE INTO truck_profiles (id,plate,notes,is_active,created_at,updated_at)
        VALUES ('system_supplier_delivery_truck','SUPPLIER-DELIVERY','Internal compatibility record; hidden from active truck lists.',0,'${seededAt}','${seededAt}');
    `);
    currentVersion = 24;
  }

  if (currentVersion === 24) {
    await db.execAsync(`
      CREATE TABLE fuel_price_history (
        id TEXT PRIMARY KEY NOT NULL,
        price_per_litre_usd_cents INTEGER NOT NULL CHECK (price_per_litre_usd_cents >= 0),
        effective_at TEXT NOT NULL,
        changed_by TEXT NOT NULL DEFAULT 'Owner',
        reason TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_fuel_price_history_effective
        ON fuel_price_history(effective_at DESC,created_at DESC);
      ALTER TABLE fuel_movements ADD COLUMN fuel_price_history_id TEXT REFERENCES fuel_price_history(id);
      ALTER TABLE fuel_movements ADD COLUMN consumption_cost_usd_cents INTEGER
        CHECK (consumption_cost_usd_cents IS NULL OR consumption_cost_usd_cents >= 0);
      ALTER TABLE fuel_movements ADD COLUMN price_override_reason TEXT;
    `);
    currentVersion = 25;
  }

  if (currentVersion === 25) {
    const seededAt=new Date().toISOString();
    type ExistingCubicUnit={id:string;name:string;symbol:string};
    let cubicUnit=await db.getFirstAsync<ExistingCubicUnit>(`
      SELECT id,name,symbol FROM measurement_units
      WHERE lower(name) IN ('cubic metre','cubic meter')
         OR lower(replace(symbol,' ','')) IN ('m³','m3','m^3')
      ORDER BY CASE WHEN id='unit_m3' THEN 0 ELSE 1 END,created_at
      LIMIT 1
    `);
    if(!cubicUnit?.id){
      await db.execAsync(`INSERT OR IGNORE INTO measurement_units (id,name,symbol,created_at,updated_at)
        VALUES ('unit_m3','Cubic metre','m³','${seededAt}','${seededAt}');`);
      const insertedUnit=await db.getFirstAsync<ExistingCubicUnit>(`
        SELECT id,name,symbol FROM measurement_units
        WHERE id='unit_m3' OR lower(name) IN ('cubic metre','cubic meter')
          OR lower(replace(symbol,' ','')) IN ('m³','m3','m^3')
        ORDER BY CASE WHEN id='unit_m3' THEN 0 ELSE 1 END,created_at
        LIMIT 1
      `);
      cubicUnit=insertedUnit?.id?insertedUnit:{id:'unit_m3',name:'Cubic metre',symbol:'m³'};
    }
    await addColumnIfMissing(db,'quarry_purchases','unit_id','TEXT REFERENCES measurement_units(id)');
    await addColumnIfMissing(db,'quarry_purchases','unit_name','TEXT');
    await addColumnIfMissing(db,'quarry_purchases','unit_symbol','TEXT');
    await addColumnIfMissing(db,'quarry_purchases','price_basis',"TEXT NOT NULL DEFAULT 'per_unit' CHECK (price_basis IN ('per_unit','whole'))");
    await addColumnIfMissing(db,'quarry_purchases','vat_mode',"TEXT NOT NULL DEFAULT 'company' CHECK (vat_mode IN ('company','none','custom'))");
    await addColumnIfMissing(db,'quarry_purchases','vat_inclusive','INTEGER NOT NULL DEFAULT 0 CHECK (vat_inclusive IN (0,1))');
    await addColumnIfMissing(db,'quarry_purchases','correction_history_json',"TEXT NOT NULL DEFAULT '[]'");
    await addColumnIfMissing(db,'quarry_purchases','updated_at','TEXT');
    await addColumnIfMissing(db,'daily_project_reports','safety_json',"TEXT NOT NULL DEFAULT '[]'");
    await db.execAsync(`UPDATE quarry_purchases SET
      unit_id=${sqlText(cubicUnit.id)},
      unit_name=COALESCE(unit_name,${sqlText(cubicUnit.name)}),
      unit_symbol=COALESCE(unit_symbol,${sqlText(cubicUnit.symbol)}),
      updated_at=COALESCE(updated_at,confirmed_at)
      WHERE unit_id IS NULL;`);
    currentVersion = 26;
  }

  if (currentVersion === 26) {
    await addColumnIfMissing(db,'fuel_movements','equipment_type',"TEXT NOT NULL DEFAULT 'machine' CHECK (equipment_type IN ('machine','truck'))");
    await addColumnIfMissing(db,'fuel_movements','truck_profile_id','TEXT REFERENCES truck_profiles(id)');
    await addColumnIfMissing(db,'loads','entered_at','TEXT');
    await addColumnIfMissing(db,'quarry_purchases','entered_at','TEXT');
    await db.execAsync(`
      UPDATE loads SET entered_at=COALESCE(entered_at,confirmed_at);
      UPDATE quarry_purchases SET entered_at=COALESCE(entered_at,confirmed_at);
      CREATE INDEX IF NOT EXISTS idx_fuel_movements_truck ON fuel_movements(truck_profile_id,confirmed_at DESC);
    `);
    currentVersion = 27;
  }

  if (currentVersion === 27) {
    await addColumnIfMissing(db, 'loads', 'status', "TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Cancelled'))");
    await addColumnIfMissing(db, 'loads', 'cancellation_reason', 'TEXT');
    await addColumnIfMissing(db, 'loads', 'cancelled_at', 'TEXT');
    await addColumnIfMissing(db, 'loads', 'correction_history_json', "TEXT NOT NULL DEFAULT '[]'");
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_loads_status ON loads(status, confirmed_at DESC);`);
    currentVersion = 28;
  }

  if (currentVersion === 28) {
    await addColumnIfMissing(db, 'loads', 'updated_at', 'TEXT');
    await db.execAsync(`UPDATE loads SET updated_at = COALESCE(entered_at, confirmed_at) WHERE updated_at IS NULL;`);
    currentVersion = 29;
  }

  if (currentVersion === 29) {
    await addColumnIfMissing(db, 'daily_project_reports', 'consultant_signoff_enabled', 'INTEGER NOT NULL DEFAULT 0 CHECK (consultant_signoff_enabled IN (0,1))');
    await addColumnIfMissing(db, 'daily_project_reports', 'consultant_name', 'TEXT');
    await addColumnIfMissing(db, 'daily_project_reports', 'consultant_signature_json', "TEXT NOT NULL DEFAULT '[]'");
    currentVersion = 30;
  }

  if (currentVersion === 30) {
    await addColumnIfMissing(db, 'company_settings', 'ministry_name', 'TEXT');
    await addColumnIfMissing(db, 'company_settings', 'ministry_logo_uri', 'TEXT');
    await addColumnIfMissing(db, 'daily_project_reports', 'show_ministry_header', 'INTEGER NOT NULL DEFAULT 0 CHECK (show_ministry_header IN (0,1))');
    currentVersion = 31;
  }

  if (currentVersion === 31) {
    await addColumnIfMissing(db, 'company_settings', 'consulting_agency_name', 'TEXT');
    currentVersion = 32;
  }

  if (currentVersion === 32) {
    await addColumnIfMissing(db, 'fuel_movements', 'fuel_type', "TEXT NOT NULL DEFAULT 'diesel' CHECK (fuel_type IN ('diesel','gasoline'))");
    await addColumnIfMissing(db, 'fuel_price_history', 'fuel_type', "TEXT NOT NULL DEFAULT 'diesel' CHECK (fuel_type IN ('diesel','gasoline'))");
    await addColumnIfMissing(db, 'fuel_movements', 'correction_history_json', "TEXT NOT NULL DEFAULT '[]'");
    currentVersion = 33;
  }

  if (currentVersion === 33) {
    // DEC-398. `ministry_name` and `consulting_agency_name` stay the English values so existing rows
    // and the backup format are untouched; only the Arabic partners are new. The custom header has
    // no legacy column, so both of its languages are explicit.
    await addColumnIfMissing(db, 'company_settings', 'ministry_name_ar', 'TEXT');
    await addColumnIfMissing(db, 'company_settings', 'consulting_agency_name_ar', 'TEXT');
    await addColumnIfMissing(db, 'company_settings', 'custom_header_en', 'TEXT');
    await addColumnIfMissing(db, 'company_settings', 'custom_header_ar', 'TEXT');
    await addColumnIfMissing(db, 'daily_project_reports', 'show_consulting_agency', 'INTEGER NOT NULL DEFAULT 0 CHECK (show_consulting_agency IN (0,1))');
    await addColumnIfMissing(db, 'daily_project_reports', 'show_custom_header', 'INTEGER NOT NULL DEFAULT 0 CHECK (show_custom_header IN (0,1))');
    // DEC-399. A plain DEFAULT 0 would be a silent regression: every existing report that prints an
    // agency line today (because its Consultant Sign-off is on) would stop printing it on
    // regeneration. Backfilling reproduces today's output exactly. New reports still default to off.
    await db.execAsync('UPDATE daily_project_reports SET show_consulting_agency = 1 WHERE consultant_signoff_enabled = 1;');
    currentVersion = 34;
  }

  if (currentVersion === 34) {
    // DEC-416/DEC-417. Consulting agencies become a reusable, per-project list instead of one
    // global free-text pair. The legacy global value is preserved by seeding it as the first saved
    // agency, and every project is backfilled to reference it, so the app's existing behaviour is
    // unchanged the moment this migration finishes: every project still prints the same agency it
    // would have printed before, until an owner deliberately assigns a different one.
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS consulting_agencies (
        id TEXT PRIMARY KEY NOT NULL,
        name_en TEXT NOT NULL,
        name_ar TEXT,
        -- Application-computed duplicate-detection key (trim, collapse internal whitespace,
        -- case-fold). SQLite enforces uniqueness of this stored key via the index below; only the
        -- repository ever computes and writes it at runtime (domain/profiles.ts's
        -- normalizeAgencyKey), never a caller/UI draft, so "Cedar", " Cedar ", and "CEDAR" all
        -- collide as one row. This migration's own one-time seed uses a frozen local copy of that
        -- same rule (migration35NormalizeAgencyKey above), not the live domain function.
        name_en_key TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_consulting_agencies_name_en_key ON consulting_agencies(name_en_key);
    `);
    await addColumnIfMissing(db, 'projects', 'consulting_agency_id', 'TEXT REFERENCES consulting_agencies(id)');
    await addColumnIfMissing(db, 'daily_project_reports', 'consulting_agency_id', 'TEXT REFERENCES consulting_agencies(id)');
    await addColumnIfMissing(db, 'daily_project_reports', 'consulting_agency_name_en', 'TEXT');
    await addColumnIfMissing(db, 'daily_project_reports', 'consulting_agency_name_ar', 'TEXT');

    const legacy = await db.getFirstAsync<{ consulting_agency_name: string | null; consulting_agency_name_ar: string | null }>(
      "SELECT consulting_agency_name, consulting_agency_name_ar FROM company_settings WHERE id = 'company'",
    );
    const legacyEnglish = (legacy?.consulting_agency_name ?? '').trim();
    const legacyArabic = (legacy?.consulting_agency_name_ar ?? '').trim();

    if (legacyEnglish || legacyArabic) {
      // Honest preservation of an Arabic-only legacy value (DEC-416): nameEn stays '' rather than
      // being invented from a placeholder or copied from the Arabic text. This is the one case a
      // newly created agency can never reach, since creation requires a non-empty English name.
      const nameEn = migration35NormalizeAgencyName(legacyEnglish);
      const nameAr = legacyArabic || null;
      const key = migration35NormalizeAgencyKey(nameEn);

      let agencyId = (await db.getFirstAsync<{ id: string }>(
        'SELECT id FROM consulting_agencies WHERE name_en_key = ?', key,
      ))?.id ?? null;

      if (!agencyId) {
        agencyId = `consulting_agency_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
        const seededAt = new Date().toISOString();
        await db.runAsync(
          'INSERT INTO consulting_agencies (id, name_en, name_ar, name_en_key, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
          agencyId, nameEn, nameAr, key, seededAt, seededAt,
        );
      }

      // Idempotency guard: only fills a still-NULL reference, so re-running this step never
      // overwrites a choice made after the first run.
      await db.runAsync('UPDATE projects SET consulting_agency_id = ? WHERE consulting_agency_id IS NULL', agencyId);

      // Only the reports that were actually printing the header today get a snapshot — an existing
      // report whose switch is off printed no agency before this migration and prints none after.
      await db.runAsync(
        `UPDATE daily_project_reports
         SET consulting_agency_id = ?, consulting_agency_name_en = ?, consulting_agency_name_ar = ?
         WHERE show_consulting_agency = 1 AND consulting_agency_id IS NULL`,
        agencyId, nameEn, nameAr,
      );
    }
    currentVersion = 35;
  }

  if (currentVersion === 35) {
    // DEC-438. Saved company sites and the fuel destination of an equipment fill. Only execAsync and
    // addColumnIfMissing are used, so the step runs identically on every supported database adapter.
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS company_sites (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        -- Repository-computed duplicate key (trim, collapse internal whitespace, case-fold). It is
        -- unique among active sites only, so a deactivated site's name can be used by a new site.
        name_key TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_company_sites_active_name_key ON company_sites(name_key) WHERE is_active = 1;
    `);
    await addColumnIfMissing(db, 'fuel_movements', 'company_site_id', 'TEXT REFERENCES company_sites(id)');
    // NULL is reserved for purchases, gauge readings, and a fill not yet backfilled; every value that
    // is stored must agree with its links, so a stale hidden project or site id can never persist.
    await addColumnIfMissing(db, 'fuel_movements', 'destination_type', `TEXT CHECK (
      destination_type IS NULL OR (movement_type = 'fill' AND (
        (destination_type = 'project' AND project_id IS NOT NULL AND company_site_id IS NULL) OR
        (destination_type = 'company_site' AND company_site_id IS NOT NULL AND project_id IS NULL) OR
        (destination_type = 'unassigned' AND project_id IS NULL AND company_site_id IS NULL)
      ))
    )`);
    // Deterministic backfill: a fill with a project link was project fuel; every other existing fill
    // is Unassigned. No existing fill is ever classified as a Company Site. Only still-NULL rows are
    // touched, so re-entering this step never overrides a destination chosen after the first run.
    await db.execAsync(`
      UPDATE fuel_movements
        SET destination_type = CASE WHEN project_id IS NOT NULL THEN 'project' ELSE 'unassigned' END
        WHERE movement_type = 'fill' AND destination_type IS NULL;
      CREATE INDEX IF NOT EXISTS idx_fuel_movements_company_site ON fuel_movements(company_site_id, confirmed_at DESC);
    `);
    currentVersion = 36;
  }

  if (currentVersion === 36) {
    // DEC-450 to DEC-453. Wall consumption covered area, saved Concrete/Mortar purposes, and reasoned
    // corrections. Structure only: no existing row is read, rewritten, or backfilled, so every legacy
    // consumption keeps NULL area (displayed as "Area not recorded", never zero) and an empty history.
    // Nothing is normalized here, so no frozen copy of the live purpose normalization is needed.
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS wall_concrete_purposes (
        id TEXT PRIMARY KEY NOT NULL,
        label TEXT NOT NULL CHECK (length(trim(label)) > 0),
        -- Repository-computed duplicate key (trim, collapse internal whitespace, case-fold).
        label_key TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_wall_concrete_purposes_label_key ON wall_concrete_purposes(label_key);
    `);
    await addColumnIfMissing(db, 'wall_consumptions', 'custom_purpose_id', 'TEXT REFERENCES wall_concrete_purposes(id)');
    // The label is snapshotted with the record. A record uses a built-in purpose or a saved one, never both.
    await addColumnIfMissing(db, 'wall_consumptions', 'custom_purpose_label', `TEXT CHECK (
      (custom_purpose_id IS NULL AND custom_purpose_label IS NULL) OR
      (custom_purpose_id IS NOT NULL AND custom_purpose_label IS NOT NULL AND length(trim(custom_purpose_label)) > 0 AND concrete_purpose IS NULL AND material_type IN ('ready_mix','site_mix'))
    )`);
    await addColumnIfMissing(db, 'wall_consumptions', 'area_length_m', 'REAL CHECK (area_length_m IS NULL OR area_length_m > 0)');
    await addColumnIfMissing(db, 'wall_consumptions', 'area_height_m', 'REAL CHECK (area_height_m IS NULL OR area_height_m > 0)');
    await addColumnIfMissing(db, 'wall_consumptions', 'area_deduction_m2', 'REAL CHECK (area_deduction_m2 IS NULL OR area_deduction_m2 >= 0)');
    await addColumnIfMissing(db, 'wall_consumptions', 'area_gross_m2', 'REAL CHECK (area_gross_m2 IS NULL OR area_gross_m2 > 0)');
    // The whole snapshot is present or absent together, only on Stone or Ready Mix, and deductions
    // can never reach the gross area. Every comparison is guarded with IS NOT NULL, because a CHECK
    // expression that evaluates to NULL passes.
    await addColumnIfMissing(db, 'wall_consumptions', 'area_net_m2', `REAL CHECK (
      (area_net_m2 IS NULL AND area_length_m IS NULL AND area_height_m IS NULL AND area_deduction_m2 IS NULL AND area_gross_m2 IS NULL) OR
      (area_net_m2 IS NOT NULL AND area_net_m2 > 0 AND area_length_m IS NOT NULL AND area_height_m IS NOT NULL AND area_deduction_m2 IS NOT NULL AND area_gross_m2 IS NOT NULL
        AND area_deduction_m2 < area_gross_m2 AND material_type IN ('stone','ready_mix'))
    )`);
    await addColumnIfMissing(db, 'wall_consumptions', 'correction_history_json', "TEXT NOT NULL DEFAULT '[]'");
    // NULL means the record has never been corrected.
    await addColumnIfMissing(db, 'wall_consumptions', 'updated_at', 'TEXT');
    await db.execAsync('CREATE INDEX IF NOT EXISTS idx_wall_consumptions_used_on ON wall_consumptions(used_on, wall_id);');
    currentVersion = 37;
  }

  if (currentVersion === 37) {
    // DEC-455, superseding DEC-450 before release. Stone and Ready Mix consumption is calculated as a
    // volume with the section 1 wall formula (length x height x average of bottom and top thickness,
    // less deductions in m3), and the calculated net volume fills the consumed quantity. The snapshot
    // is stored here. Structure only: no row is read, rewritten, or backfilled; the migration-37 area
    // columns stay in place, unused, so a database that already reached version 37 is untouched.
    await addColumnIfMissing(db, 'wall_consumptions', 'volume_length_m', 'REAL CHECK (volume_length_m IS NULL OR volume_length_m > 0)');
    await addColumnIfMissing(db, 'wall_consumptions', 'volume_height_m', 'REAL CHECK (volume_height_m IS NULL OR volume_height_m > 0)');
    await addColumnIfMissing(db, 'wall_consumptions', 'volume_bottom_thickness_m', 'REAL CHECK (volume_bottom_thickness_m IS NULL OR volume_bottom_thickness_m > 0)');
    await addColumnIfMissing(db, 'wall_consumptions', 'volume_top_thickness_m', 'REAL CHECK (volume_top_thickness_m IS NULL OR volume_top_thickness_m > 0)');
    await addColumnIfMissing(db, 'wall_consumptions', 'volume_deduction_m3', 'REAL CHECK (volume_deduction_m3 IS NULL OR volume_deduction_m3 >= 0)');
    await addColumnIfMissing(db, 'wall_consumptions', 'volume_gross_m3', 'REAL CHECK (volume_gross_m3 IS NULL OR volume_gross_m3 > 0)');
    // The snapshot is all present or all absent, only on Stone or Ready Mix, with deductions below the
    // gross volume. Comparisons are guarded with IS NOT NULL because a CHECK evaluating to NULL passes.
    await addColumnIfMissing(db, 'wall_consumptions', 'volume_net_m3', `REAL CHECK (
      (volume_net_m3 IS NULL AND volume_length_m IS NULL AND volume_height_m IS NULL AND volume_bottom_thickness_m IS NULL
        AND volume_top_thickness_m IS NULL AND volume_deduction_m3 IS NULL AND volume_gross_m3 IS NULL) OR
      (volume_net_m3 IS NOT NULL AND volume_net_m3 > 0 AND volume_length_m IS NOT NULL AND volume_height_m IS NOT NULL
        AND volume_bottom_thickness_m IS NOT NULL AND volume_top_thickness_m IS NOT NULL AND volume_deduction_m3 IS NOT NULL
        AND volume_gross_m3 IS NOT NULL AND volume_deduction_m3 < volume_gross_m3 AND material_type IN ('stone','ready_mix'))
    )`);
    currentVersion = 38;
  }

  if (currentVersion === 38) {
    // DEC-457. Wall layers and construction phases, the structured data the generated technical
    // diagram is drawn from. Structure only: no existing wall or consumption row is read or changed,
    // and layers stay optional, so every historical wall remains valid with no layers at all.
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS wall_layers (
        id TEXT PRIMARY KEY NOT NULL,
        wall_id TEXT NOT NULL REFERENCES walls(id),
        -- Construction order, 1 upwards. Unique per wall, so two layers can never claim one phase.
        phase_order INTEGER NOT NULL CHECK (phase_order >= 1 AND phase_order = CAST(phase_order AS INTEGER)),
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        -- Optional link to a catalog/material key; the name is always the printed label.
        material_key TEXT,
        bottom_thickness_m REAL NOT NULL CHECK (bottom_thickness_m > 0),
        top_thickness_m REAL NOT NULL CHECK (top_thickness_m > 0),
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_wall_layers_phase ON wall_layers(wall_id, phase_order);
      CREATE INDEX IF NOT EXISTS idx_wall_layers_wall ON wall_layers(wall_id, phase_order);
    `);
    currentVersion = 39;
  }

  if (currentVersion === 39) {
    // DEC-459. The mandatory base of a wall section: its geometry and consumed material, then the
    // construction, curing, and explicit cured confirmation that unlock wall work above it. Structure
    // only: no base is invented for an existing wall and no curing data is fabricated. Walls that
    // already exist keep base_required = 0 (the column default) and stay usable as legacy walls; the
    // repository sets 1 on every wall created from now on.
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS wall_bases (
        id TEXT PRIMARY KEY NOT NULL,
        -- One base per wall section, enforced by the unique index below.
        wall_id TEXT NOT NULL REFERENCES walls(id),
        reference TEXT NOT NULL CHECK (length(trim(reference)) > 0),
        location TEXT,
        length_m REAL NOT NULL CHECK (length_m > 0),
        height_m REAL NOT NULL CHECK (height_m > 0),
        bottom_thickness_m REAL NOT NULL CHECK (bottom_thickness_m > 0),
        top_thickness_m REAL NOT NULL CHECK (top_thickness_m > 0),
        deduction_m3 REAL NOT NULL DEFAULT 0 CHECK (deduction_m3 >= 0),
        gross_volume_m3 REAL NOT NULL CHECK (gross_volume_m3 > 0),
        net_volume_m3 REAL NOT NULL CHECK (net_volume_m3 > 0 AND net_volume_m3 <= gross_volume_m3),
        material_type TEXT NOT NULL CHECK (material_type IN ('ready_mix','site_mix','stone')),
        concrete_purpose TEXT CHECK (concrete_purpose IN ('structural','filling','cyclopean_matrix','mortar','footing','coping')),
        custom_purpose_id TEXT REFERENCES wall_concrete_purposes(id),
        custom_purpose_label TEXT,
        quantity REAL NOT NULL CHECK (quantity > 0),
        quantity_unit TEXT NOT NULL CHECK (quantity_unit IN ('m3','tonnes')),
        -- A quantity that differs from the calculated volume is always a deliberate override.
        manual_override INTEGER NOT NULL DEFAULT 0 CHECK (manual_override IN (0, 1)),
        consumption_date TEXT,
        -- The lifecycle is constrained here as well as in the domain, so an invalid state fails closed.
        status TEXT NOT NULL CHECK (status IN ('planned','constructed','curing','cured')),
        constructed_on TEXT,
        curing_started_on TEXT,
        cured_on TEXT,
        curing_note TEXT,
        notes TEXT,
        correction_history_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT,
        -- Dates may only run forwards, and a status past planned must carry the dates it implies.
        CHECK (constructed_on IS NULL OR curing_started_on IS NULL OR curing_started_on >= constructed_on),
        CHECK (curing_started_on IS NULL OR cured_on IS NULL OR cured_on >= curing_started_on),
        CHECK (status = 'planned' OR constructed_on IS NOT NULL),
        CHECK (status <> 'curing' OR curing_started_on IS NOT NULL),
        CHECK (status <> 'cured' OR cured_on IS NOT NULL)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_wall_bases_wall ON wall_bases(wall_id);
      CREATE INDEX IF NOT EXISTS idx_wall_bases_dates ON wall_bases(cured_on, constructed_on);
    `);
    await addColumnIfMissing(db, 'walls', 'base_required', 'INTEGER NOT NULL DEFAULT 0 CHECK (base_required IN (0, 1))');
    currentVersion = 40;
  }

  if (currentVersion === 40) {
    // DEC-461. The composite foundation model: a base's outer geometry may optionally hold a Stone
    // core, with the concrete that fills the rest estimated rather than assumed poured. Additive only
    // -- every existing base keeps foundation_mode = 'single' (the column default) and its own
    // materialType/quantity exactly as recorded; nothing here changes an existing base's data.
    await addColumnIfMissing(db, 'wall_bases', 'foundation_mode', "TEXT NOT NULL DEFAULT 'single' CHECK (foundation_mode IN ('single','composite'))");
    await addColumnIfMissing(db, 'wall_bases', 'stone_core_mode', "TEXT CHECK (stone_core_mode IN ('simple','detailed'))");
    await addColumnIfMissing(db, 'wall_bases', 'stone_core_position_x', 'REAL CHECK (stone_core_position_x IS NULL OR (stone_core_position_x >= 0 AND stone_core_position_x <= 1))');
    await addColumnIfMissing(db, 'wall_bases', 'stone_core_position_y', 'REAL CHECK (stone_core_position_y IS NULL OR (stone_core_position_y >= 0 AND stone_core_position_y <= 1))');
    await addColumnIfMissing(db, 'wall_bases', 'stone_core_offsets_json', 'TEXT');
    await db.execAsync(`
      -- DEC-461. Multiple Stone/Ready-Mix records against one composite base, each cancellable and
      -- correctable in place, so the aggregate Stone core and estimated concrete always derive from
      -- the same active, auditable records rather than a single overwritten quantity.
      CREATE TABLE IF NOT EXISTS wall_base_composition_records (
        id TEXT PRIMARY KEY NOT NULL,
        base_id TEXT NOT NULL REFERENCES wall_bases(id),
        wall_id TEXT NOT NULL REFERENCES walls(id),
        material_type TEXT NOT NULL CHECK (material_type IN ('stone','ready_mix')),
        quantity_m3 REAL NOT NULL CHECK (quantity_m3 > 0),
        recorded_on TEXT NOT NULL,
        notes TEXT,
        cancelled_at TEXT,
        cancelled_reason TEXT,
        correction_history_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT,
        CHECK (cancelled_at IS NULL OR cancelled_reason IS NOT NULL)
      );
      CREATE INDEX IF NOT EXISTS idx_wall_base_composition_base ON wall_base_composition_records(base_id, material_type);
    `);
    currentVersion = 41;
  }

  if (currentVersion === 41) {
    // DEC-464. Foundations become independent of any single wall: a named, project-scoped
    // Construction Section groups any number of Foundations, and a Foundation may exist before a
    // wall is ever linked to it. `wall_bases` (one base per wall, DEC-459/460) is rebuilt as
    // `foundations` (one row per foundation, addressable on its own), following the same
    // create-copy-drop-rename technique already used for payment_entries in migration 13. Every
    // existing wall_bases row keeps its own id, so wall_base_composition_records keeps working once
    // its own foreign key is repointed the same way. No existing base, curing date, correction, or
    // composition record is altered -- only where they live changes. Existing walls that already had
    // a base are linked to their now-independent foundation through the new walls.foundation_id
    // column; walls that had none (legacy walls, DEC-459) are left exactly as they are, with no
    // foundation invented for them. A deterministic "Legacy Section" is created per project that had
    // at least one base, never a real site name, and it may be renamed later like any other section.
    //
    // `wall_bases` and `wall_base_composition_records` are deliberately left in place, never dropped
    // or renamed: migrations 39-41 above assume those exact table names and shapes are always safe to
    // recreate with IF NOT EXISTS, an assumption their own tests exercise by resetting PRAGMA
    // user_version on an already-current database and replaying every step. Touching either table's
    // name or shape here would silently break that replay for every earlier migration. `foundations`
    // and `foundation_composition_records` are new, independently named tables instead; the old ones
    // become inert historical remnants once this step runs, superseded but harmless and undeleted.
    // Every insert below is idempotent (INSERT OR IGNORE, or an addColumnIfMissing/IF NOT EXISTS
    // index/column), so this whole step is also safe to replay on its own for the same reason.
    const seededAt = new Date().toISOString();
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS construction_sections (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id),
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        name_key TEXT NOT NULL,
        location TEXT,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_construction_sections_name ON construction_sections(project_id, name_key);
      CREATE INDEX IF NOT EXISTS idx_construction_sections_project ON construction_sections(project_id);

      -- One deterministic legacy section per project that already has at least one base, so every
      -- migrated foundation has a section to belong to without inventing a real site name.
      INSERT OR IGNORE INTO construction_sections (id,project_id,name,name_key,location,description,created_at,updated_at)
        SELECT 'section_legacy_' || w.project_id, w.project_id, 'Legacy Section', 'legacy section', NULL,
          'Created automatically during migration 42 to hold foundations that existed before Construction Sections. Rename it freely.',
          '${seededAt}', '${seededAt}'
        FROM wall_bases wb JOIN walls w ON w.id = wb.wall_id
        GROUP BY w.project_id;

      CREATE TABLE IF NOT EXISTS foundations (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id),
        construction_section_id TEXT NOT NULL REFERENCES construction_sections(id),
        -- Set only for a foundation migrated from a pre-DEC-464 wall base; never set by new code,
        -- which links a wall through walls.foundation_id instead.
        legacy_wall_id TEXT REFERENCES walls(id),
        reference TEXT NOT NULL CHECK (length(trim(reference)) > 0),
        location TEXT,
        length_m REAL NOT NULL CHECK (length_m > 0),
        height_m REAL NOT NULL CHECK (height_m > 0),
        bottom_thickness_m REAL NOT NULL CHECK (bottom_thickness_m > 0),
        top_thickness_m REAL NOT NULL CHECK (top_thickness_m > 0),
        deduction_m3 REAL NOT NULL DEFAULT 0 CHECK (deduction_m3 >= 0),
        gross_volume_m3 REAL NOT NULL CHECK (gross_volume_m3 > 0),
        net_volume_m3 REAL NOT NULL CHECK (net_volume_m3 > 0 AND net_volume_m3 <= gross_volume_m3),
        material_type TEXT NOT NULL CHECK (material_type IN ('ready_mix','site_mix','stone')),
        concrete_purpose TEXT CHECK (concrete_purpose IN ('structural','filling','cyclopean_matrix','mortar','footing','coping')),
        custom_purpose_id TEXT REFERENCES wall_concrete_purposes(id),
        custom_purpose_label TEXT,
        quantity REAL NOT NULL CHECK (quantity > 0),
        quantity_unit TEXT NOT NULL CHECK (quantity_unit IN ('m3','tonnes')),
        manual_override INTEGER NOT NULL DEFAULT 0 CHECK (manual_override IN (0, 1)),
        consumption_date TEXT,
        status TEXT NOT NULL CHECK (status IN ('planned','constructed','curing','cured')),
        constructed_on TEXT,
        curing_started_on TEXT,
        cured_on TEXT,
        curing_note TEXT,
        notes TEXT,
        correction_history_json TEXT NOT NULL DEFAULT '[]',
        foundation_mode TEXT NOT NULL DEFAULT 'single' CHECK (foundation_mode IN ('single','composite')),
        stone_core_mode TEXT CHECK (stone_core_mode IN ('simple','detailed')),
        stone_core_position_x REAL CHECK (stone_core_position_x IS NULL OR (stone_core_position_x >= 0 AND stone_core_position_x <= 1)),
        stone_core_position_y REAL CHECK (stone_core_position_y IS NULL OR (stone_core_position_y >= 0 AND stone_core_position_y <= 1)),
        stone_core_offsets_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        CHECK (constructed_on IS NULL OR curing_started_on IS NULL OR curing_started_on >= constructed_on),
        CHECK (curing_started_on IS NULL OR cured_on IS NULL OR cured_on >= curing_started_on),
        CHECK (status = 'planned' OR constructed_on IS NOT NULL),
        CHECK (status <> 'curing' OR curing_started_on IS NOT NULL),
        CHECK (status <> 'cured' OR cured_on IS NOT NULL)
      );
      CREATE INDEX IF NOT EXISTS idx_foundations_project ON foundations(project_id);
      CREATE INDEX IF NOT EXISTS idx_foundations_section ON foundations(construction_section_id);
      CREATE INDEX IF NOT EXISTS idx_foundations_legacy_wall ON foundations(legacy_wall_id);

      INSERT OR IGNORE INTO foundations (id,project_id,construction_section_id,legacy_wall_id,reference,location,length_m,height_m,bottom_thickness_m,top_thickness_m,deduction_m3,gross_volume_m3,net_volume_m3,material_type,concrete_purpose,custom_purpose_id,custom_purpose_label,quantity,quantity_unit,manual_override,consumption_date,status,constructed_on,curing_started_on,cured_on,curing_note,notes,correction_history_json,foundation_mode,stone_core_mode,stone_core_position_x,stone_core_position_y,stone_core_offsets_json,created_at,updated_at)
        SELECT wb.id, w.project_id, 'section_legacy_' || w.project_id, wb.wall_id, wb.reference, wb.location, wb.length_m, wb.height_m, wb.bottom_thickness_m, wb.top_thickness_m, wb.deduction_m3, wb.gross_volume_m3, wb.net_volume_m3, wb.material_type, wb.concrete_purpose, wb.custom_purpose_id, wb.custom_purpose_label, wb.quantity, wb.quantity_unit, wb.manual_override, wb.consumption_date, wb.status, wb.constructed_on, wb.curing_started_on, wb.cured_on, wb.curing_note, wb.notes, wb.correction_history_json, wb.foundation_mode, wb.stone_core_mode, wb.stone_core_position_x, wb.stone_core_position_y, wb.stone_core_offsets_json, wb.created_at, wb.updated_at
        FROM wall_bases wb JOIN walls w ON w.id = wb.wall_id;

      -- A new, independently named table -- see the note above on why wall_base_composition_records
      -- itself is left untouched rather than repointed or renamed in place.
      CREATE TABLE IF NOT EXISTS foundation_composition_records (
        id TEXT PRIMARY KEY NOT NULL,
        foundation_id TEXT NOT NULL REFERENCES foundations(id),
        material_type TEXT NOT NULL CHECK (material_type IN ('stone','ready_mix')),
        quantity_m3 REAL NOT NULL CHECK (quantity_m3 > 0),
        recorded_on TEXT NOT NULL,
        notes TEXT,
        cancelled_at TEXT,
        cancelled_reason TEXT,
        correction_history_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT,
        CHECK (cancelled_at IS NULL OR cancelled_reason IS NOT NULL)
      );
      CREATE INDEX IF NOT EXISTS idx_foundation_composition_foundation ON foundation_composition_records(foundation_id, material_type);
      INSERT OR IGNORE INTO foundation_composition_records (id,foundation_id,material_type,quantity_m3,recorded_on,notes,cancelled_at,cancelled_reason,correction_history_json,created_at,updated_at)
        SELECT id, base_id, material_type, quantity_m3, recorded_on, notes, cancelled_at, cancelled_reason, correction_history_json, created_at, updated_at
        FROM wall_base_composition_records;
    `);
    await addColumnIfMissing(db, 'walls', 'foundation_id', 'TEXT REFERENCES foundations(id)');
    await db.execAsync(`
      UPDATE walls SET foundation_id = (SELECT f.id FROM foundations f WHERE f.legacy_wall_id = walls.id)
        WHERE EXISTS (SELECT 1 FROM foundations f WHERE f.legacy_wall_id = walls.id);
      -- One active wall per foundation (Checkpoint 2), enforced at the database level.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_walls_foundation ON walls(foundation_id) WHERE foundation_id IS NOT NULL;
    `);
    currentVersion = 42;
  }

  if (currentVersion === 42) {
    // DEC-466. Corrects the cyclopean construction model: a foundation or wall is built as an
    // ordered series of lifts (place Stone, then pour the concrete matrix around/through it), not
    // one Stone core sitting inside a single gross volume. Purely additive -- migrations 37-42 and
    // the wallFoundation.ts single-core model (foundations.foundation_mode/stone_core_*,
    // foundation_composition_records) are untouched, still readable, and still the only
    // representation for any foundation created before this migration. One row is the whole
    // aggregate (a lift plus its Stone phase plus its concrete matrix phase) so a concrete phase can
    // never end up paired with the wrong lift through a separate, independently-keyed table.
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS cyclopean_lifts (
        id TEXT PRIMARY KEY NOT NULL,
        parent_type TEXT NOT NULL CHECK (parent_type IN ('foundation','wall')),
        foundation_id TEXT REFERENCES foundations(id),
        wall_id TEXT REFERENCES walls(id),
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        reference TEXT NOT NULL CHECK (length(trim(reference)) > 0),
        start_elevation_m REAL NOT NULL,
        length_m REAL NOT NULL CHECK (length_m > 0),
        height_m REAL NOT NULL CHECK (height_m > 0),
        bottom_thickness_m REAL NOT NULL CHECK (bottom_thickness_m > 0),
        top_thickness_m REAL NOT NULL CHECK (top_thickness_m > 0),
        deduction_m3 REAL NOT NULL DEFAULT 0 CHECK (deduction_m3 >= 0),
        -- A historical structural-volume snapshot, the same convention foundations/wall_bases/walls
        -- already use for their own net_volume_m3: it is what capacity reconciliation and every past
        -- report add up, so it must never silently reinterpret itself if the trapezoid formula is
        -- ever revised. It is always written from calculateVolumeSnapshot, never typed by hand.
        net_lift_volume_m3 REAL NOT NULL CHECK (net_lift_volume_m3 > 0),
        -- Lifecycle constrained here too, so an invalid status fails closed even if a caller bypasses the repository.
        status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','stone_placed','completed')),

        -- Stone phase. A calculation snapshot is null when the Stone quantity was entered directly
        -- with no calculator, in which case stone_calculated_volume_m3 stays 0 -- never invented.
        stone_calc_length_m REAL, stone_calc_height_m REAL, stone_calc_bottom_thickness_m REAL, stone_calc_top_thickness_m REAL,
        stone_calc_deduction_m3 REAL, stone_calc_gross_volume_m3 REAL, stone_calc_net_volume_m3 REAL,
        stone_calculated_volume_m3 REAL NOT NULL DEFAULT 0 CHECK (stone_calculated_volume_m3 >= 0),
        stone_actual_quantity_m3 REAL CHECK (stone_actual_quantity_m3 IS NULL OR stone_actual_quantity_m3 >= 0),
        stone_manual_override INTEGER NOT NULL DEFAULT 0 CHECK (stone_manual_override IN (0, 1)),
        stone_work_date TEXT,
        stone_position_x REAL CHECK (stone_position_x IS NULL OR (stone_position_x >= 0 AND stone_position_x <= 1)),
        stone_position_y REAL CHECK (stone_position_y IS NULL OR (stone_position_y >= 0 AND stone_position_y <= 1)),
        stone_offsets_json TEXT,
        stone_notes TEXT,

        -- Concrete matrix phase. Absent (Concrete fill pending) is represented by
        -- concrete_calculation_method IS NULL across the whole phase -- never a placeholder row.
        concrete_calculation_method TEXT CHECK (concrete_calculation_method IS NULL OR concrete_calculation_method IN ('estimated_matrix','independent')),
        concrete_estimated_matrix_volume_m3 REAL CHECK (concrete_estimated_matrix_volume_m3 IS NULL OR concrete_estimated_matrix_volume_m3 >= 0),
        concrete_calc_length_m REAL, concrete_calc_height_m REAL, concrete_calc_bottom_thickness_m REAL, concrete_calc_top_thickness_m REAL,
        concrete_calc_deduction_m3 REAL, concrete_calc_gross_volume_m3 REAL, concrete_calc_net_volume_m3 REAL,
        concrete_actual_ready_mix_m3 REAL CHECK (concrete_actual_ready_mix_m3 IS NULL OR concrete_actual_ready_mix_m3 >= 0),
        concrete_manual_override INTEGER NOT NULL DEFAULT 0 CHECK (concrete_manual_override IN (0, 1)),
        concrete_purpose TEXT,
        concrete_work_date TEXT,
        concrete_notes TEXT,

        notes TEXT,
        correction_history_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT,
        -- Exactly one parent, and it must match parent_type -- never both, never neither.
        CHECK (
          (parent_type = 'foundation' AND foundation_id IS NOT NULL AND wall_id IS NULL) OR
          (parent_type = 'wall' AND wall_id IS NOT NULL AND foundation_id IS NULL)
        ),
        -- The stored status can never disagree with what the phase columns themselves say, matching
        -- domain/wallCyclopeanLift.ts's deriveLiftStatus exactly: status is 'planned' only when no
        -- Stone is recorded, and 'completed' only when the concrete matrix phase itself is recorded.
        -- Both are single boolean-equality checks because deriveLiftStatus is a pure function of
        -- exactly these two booleans -- there is no third input for the middle (stone_placed) case.
        CHECK ((stone_actual_quantity_m3 IS NOT NULL OR stone_work_date IS NOT NULL) = (status <> 'planned')),
        CHECK ((concrete_actual_ready_mix_m3 IS NOT NULL OR concrete_work_date IS NOT NULL) = (status = 'completed'))
      );
      -- Sequence is unique within its exact parent, foundation and wall scoped separately.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cyclopean_lifts_foundation_seq ON cyclopean_lifts(foundation_id, sequence) WHERE foundation_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cyclopean_lifts_wall_seq ON cyclopean_lifts(wall_id, sequence) WHERE wall_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_cyclopean_lifts_foundation ON cyclopean_lifts(foundation_id, sequence);
      CREATE INDEX IF NOT EXISTS idx_cyclopean_lifts_wall ON cyclopean_lifts(wall_id, sequence);
    `);
    currentVersion = 43;
  }

  if (currentVersion === 43) {
    // DEC-468. Corrects a data-integrity defect found during device testing: a Foundation records a
    // structural envelope (capacity), not a material consumption, so its pre-DEC-468 top-level
    // material_type/quantity/quantity_unit must be allowed to be absent rather than forcing the
    // calculated volume — or an invented number — to be stored as though material had been consumed.
    // Actual Stone and concrete belong to the Lift phases (migration 43).
    //
    // SQLite cannot drop a NOT NULL in place, so this rebuilds `foundations` and only `foundations`.
    // Every column, CHECK, index and value is otherwise carried across byte-for-byte; wall_bases,
    // cyclopean_lifts, foundation_composition_records and migrations 1-43 are untouched. Foreign keys
    // are suspended for the swap because `walls.foundation_id` references this table; the rebuild is
    // outside any transaction (the runner uses sequential execAsync), which is what allows the pragma
    // to take effect. Replaying this step on an already-rebuilt table simply rebuilds it again from
    // its own current rows, so it is safe to re-run.
    await db.execAsync(`PRAGMA foreign_keys = OFF;`);
    await db.execAsync(`
      CREATE TABLE foundations_dec468 (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id),
        construction_section_id TEXT NOT NULL REFERENCES construction_sections(id),
        legacy_wall_id TEXT REFERENCES walls(id),
        reference TEXT NOT NULL CHECK (length(trim(reference)) > 0),
        location TEXT,
        length_m REAL NOT NULL CHECK (length_m > 0),
        height_m REAL NOT NULL CHECK (height_m > 0),
        bottom_thickness_m REAL NOT NULL CHECK (bottom_thickness_m > 0),
        top_thickness_m REAL NOT NULL CHECK (top_thickness_m > 0),
        deduction_m3 REAL NOT NULL DEFAULT 0 CHECK (deduction_m3 >= 0),
        gross_volume_m3 REAL NOT NULL CHECK (gross_volume_m3 > 0),
        net_volume_m3 REAL NOT NULL CHECK (net_volume_m3 > 0 AND net_volume_m3 <= gross_volume_m3),
        -- DEC-468: optional, and all-or-nothing (see the table CHECK below). The allowed values and
        -- the greater-than-zero rule are unchanged for a record that IS present.
        material_type TEXT CHECK (material_type IS NULL OR material_type IN ('ready_mix','site_mix','stone')),
        concrete_purpose TEXT CHECK (concrete_purpose IS NULL OR concrete_purpose IN ('structural','filling','cyclopean_matrix','mortar','footing','coping')),
        custom_purpose_id TEXT REFERENCES wall_concrete_purposes(id),
        custom_purpose_label TEXT,
        quantity REAL CHECK (quantity IS NULL OR quantity > 0),
        quantity_unit TEXT CHECK (quantity_unit IS NULL OR quantity_unit IN ('m3','tonnes')),
        manual_override INTEGER NOT NULL DEFAULT 0 CHECK (manual_override IN (0, 1)),
        consumption_date TEXT,
        status TEXT NOT NULL CHECK (status IN ('planned','constructed','curing','cured')),
        constructed_on TEXT,
        curing_started_on TEXT,
        cured_on TEXT,
        curing_note TEXT,
        notes TEXT,
        correction_history_json TEXT NOT NULL DEFAULT '[]',
        foundation_mode TEXT NOT NULL DEFAULT 'single' CHECK (foundation_mode IN ('single','composite')),
        stone_core_mode TEXT CHECK (stone_core_mode IN ('simple','detailed')),
        stone_core_position_x REAL CHECK (stone_core_position_x IS NULL OR (stone_core_position_x >= 0 AND stone_core_position_x <= 1)),
        stone_core_position_y REAL CHECK (stone_core_position_y IS NULL OR (stone_core_position_y >= 0 AND stone_core_position_y <= 1)),
        stone_core_offsets_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        CHECK (constructed_on IS NULL OR curing_started_on IS NULL OR curing_started_on >= constructed_on),
        CHECK (curing_started_on IS NULL OR cured_on IS NULL OR cured_on >= curing_started_on),
        CHECK (status = 'planned' OR constructed_on IS NOT NULL),
        CHECK (status <> 'curing' OR curing_started_on IS NOT NULL),
        CHECK (status <> 'cured' OR cured_on IS NOT NULL),
        -- A foundation either carries a complete top-level material record, or none at all. A partial
        -- combination is refused at the database, not merely in the app.
        CHECK (
          (material_type IS NULL AND quantity IS NULL AND quantity_unit IS NULL) OR
          (material_type IS NOT NULL AND quantity IS NOT NULL AND quantity_unit IS NOT NULL)
        )
      );
      INSERT INTO foundations_dec468 (id,project_id,construction_section_id,legacy_wall_id,reference,location,length_m,height_m,bottom_thickness_m,top_thickness_m,deduction_m3,gross_volume_m3,net_volume_m3,material_type,concrete_purpose,custom_purpose_id,custom_purpose_label,quantity,quantity_unit,manual_override,consumption_date,status,constructed_on,curing_started_on,cured_on,curing_note,notes,correction_history_json,foundation_mode,stone_core_mode,stone_core_position_x,stone_core_position_y,stone_core_offsets_json,created_at,updated_at)
        SELECT id,project_id,construction_section_id,legacy_wall_id,reference,location,length_m,height_m,bottom_thickness_m,top_thickness_m,deduction_m3,gross_volume_m3,net_volume_m3,material_type,concrete_purpose,custom_purpose_id,custom_purpose_label,quantity,quantity_unit,manual_override,consumption_date,status,constructed_on,curing_started_on,cured_on,curing_note,notes,correction_history_json,foundation_mode,stone_core_mode,stone_core_position_x,stone_core_position_y,stone_core_offsets_json,created_at,updated_at
        FROM foundations;
      DROP TABLE foundations;
      ALTER TABLE foundations_dec468 RENAME TO foundations;
      CREATE INDEX IF NOT EXISTS idx_foundations_project ON foundations(project_id);
      CREATE INDEX IF NOT EXISTS idx_foundations_section ON foundations(construction_section_id);
      CREATE INDEX IF NOT EXISTS idx_foundations_legacy_wall ON foundations(legacy_wall_id);
    `);
    await db.execAsync(`PRAGMA foreign_keys = ON;`);
    currentVersion = 44;
  }

  if (currentVersion === 44) {
    // DEC-473. Pre-release internal rename of the Lift entity. The construction term "Cyclopean"
    // describes only one way of building a lift -- stone displacers set in a concrete matrix -- but
    // the entity itself now carries ordinary Wall and Foundation lifts too, so the stored name was
    // narrower than the thing it stores. The visible name in the app stays simply "Lift"; the
    // internal name becomes ConstructionLift and this table becomes construction_lifts.
    //
    // This is a pure rename, not a rebuild: ALTER TABLE ... RENAME TO carries every row, column,
    // CHECK and foreign key across untouched, so every Lift recorded during Expo development
    // survives exactly as it is. Only the four index names have to be recreated, because SQLite has
    // no ALTER INDEX ... RENAME; dropping and recreating an index never touches table data.
    //
    // Migration 43 still creates the table as cyclopean_lifts and is deliberately left alone: it is
    // the historical record of what that migration actually did, and a database that already ran it
    // arrives here and is renamed forward. Nothing reads cyclopean_lifts after this point.
    // A replay is possible: several migration tests reset user_version to an older number and run
    // the chain again. On that second pass migration 43's CREATE TABLE IF NOT EXISTS makes a fresh,
    // empty cyclopean_lifts beside the already-renamed construction_lifts, so the rename is chosen
    // here rather than assumed. The empty leftover is dropped only after confirming it holds no
    // rows, so a replay can never discard a real Lift.
    // The table names are inlined rather than bound: the migration runner is also driven by minimal
    // adapters (the demo-backup generator among them) whose getFirstAsync forwards no parameters, and
    // both names here are compile-time constants.
    const table=async(name:string)=>!!(await db.getFirstAsync<{name:string}>(`SELECT name FROM sqlite_master WHERE type='table' AND name='${name}'`));
    const renamed=await table('construction_lifts'),legacy=await table('cyclopean_lifts');
    if(legacy&&!renamed){
      await db.execAsync(`ALTER TABLE cyclopean_lifts RENAME TO construction_lifts;`);
    }else if(legacy&&renamed){
      const leftover=await db.getFirstAsync<{count:number}>('SELECT COUNT(*) count FROM cyclopean_lifts');
      if((leftover?.count??0)>0)throw new Error('Migration 45 found Lifts in both cyclopean_lifts and construction_lifts; refusing to drop either.');
      await db.execAsync(`DROP TABLE cyclopean_lifts;`);
    }
    await db.execAsync(`
      DROP INDEX IF EXISTS idx_cyclopean_lifts_foundation_seq;
      DROP INDEX IF EXISTS idx_cyclopean_lifts_wall_seq;
      DROP INDEX IF EXISTS idx_cyclopean_lifts_foundation;
      DROP INDEX IF EXISTS idx_cyclopean_lifts_wall;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_construction_lifts_foundation_seq ON construction_lifts(foundation_id, sequence) WHERE foundation_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_construction_lifts_wall_seq ON construction_lifts(wall_id, sequence) WHERE wall_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_construction_lifts_foundation ON construction_lifts(foundation_id, sequence);
      CREATE INDEX IF NOT EXISTS idx_construction_lifts_wall ON construction_lifts(wall_id, sequence);
    `);
    currentVersion = 45;
  }

  if (currentVersion === 45) {
    // DEC-476. Workers, Drivers and Operators become one People directory. driver_profiles is the
    // unified table and keeps its legacy name, exactly as quarry_purchases still stores Supplier
    // Loads: loads, quarry_purchases, waste_dumps and waste_counter_presets all hold foreign keys to
    // it, and keeping the table means none of those tables is rebuilt and no stored id changes.
    // Every existing driver row simply becomes a person whose role is 'driver'.
    await addColumnIfMissing(db, 'driver_profiles', 'person_role', "TEXT NOT NULL DEFAULT 'driver' CHECK (person_role IN ('worker','driver','operator'))");
    // The old worker "role" column held a trade such as Mason or Steel fixer, not a directory role.
    await addColumnIfMissing(db, 'driver_profiles', 'job_title', 'TEXT');
    // The worker_profiles id a row was moved from. It makes the move below idempotent and auditable.
    await addColumnIfMissing(db, 'driver_profiles', 'legacy_worker_id', 'TEXT');
    await addColumnIfMissing(db, 'driver_profiles', 'role_history_json', "TEXT NOT NULL DEFAULT '[]'");

    // Workers move across with every field, active state and timestamp. Nothing references a worker
    // row by id (Daily Reports store name snapshots), so a worker keeps its own id unless a driver
    // already owns it, in which case it is given a derived one; the source id is kept either way.
    // A replay, or a second run after an interrupted first one, copies only the rows still missing.
    // The table name is inlined rather than bound because minimal adapters (the demo-backup
    // generator) forward no parameters, as in migration 45.
    const workersTable = await db.getFirstAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name='worker_profiles'");
    if (workersTable) {
      await db.execAsync(`
        INSERT INTO driver_profiles (id, name, phone, license_number, notes, is_active, created_at, updated_at, person_role, job_title, legacy_worker_id)
        SELECT CASE WHEN EXISTS (SELECT 1 FROM driver_profiles d WHERE d.id = w.id) THEN 'person_from_worker_' || w.id ELSE w.id END,
               w.name, w.phone, NULL, w.notes, w.is_active, w.created_at, w.updated_at, 'worker', w.role, w.id
        FROM worker_profiles w
        WHERE NOT EXISTS (SELECT 1 FROM driver_profiles d WHERE d.legacy_worker_id = w.id);
      `);
      // The source table is dropped only after every one of its rows is confirmed present.
      const missing = await db.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) count FROM worker_profiles w WHERE NOT EXISTS (SELECT 1 FROM driver_profiles d WHERE d.legacy_worker_id = w.id)',
      );
      if (Number(missing?.count ?? 0) > 0) throw new Error('Migration 46 could not move every worker into People; nothing was removed.');
      await db.execAsync('DROP TABLE worker_profiles;');
    }
    await db.execAsync('CREATE INDEX IF NOT EXISTS idx_people_role_active ON driver_profiles(person_role, is_active, name COLLATE NOCASE);');

    // DEC-477. The role a person served in on a receipt. NULL on every receipt made before this
    // step: those could only ever name a Driver, and are displayed as such without writing a value.
    await addColumnIfMissing(db, 'loads', 'driver_role', "TEXT CHECK (driver_role IS NULL OR driver_role IN ('driver','operator'))");

    // DEC-476/478/479. Daily Report snapshots. Each is a JSON copy made when the report is saved and
    // never re-read from a directory afterwards; an existing report starts with none of them.
    await addColumnIfMissing(db, 'daily_project_reports', 'operators_json', "TEXT NOT NULL DEFAULT '[]'");
    await addColumnIfMissing(db, 'daily_project_reports', 'custom_resources_json', "TEXT NOT NULL DEFAULT '[]'");
    await addColumnIfMissing(db, 'daily_project_reports', 'supervisor_signoffs_json', "TEXT NOT NULL DEFAULT '[]'");

    // DEC-478. Owner-defined resource directories in two generic tables -- never a table per
    // directory. name_key is written only by the repository; this step creates empty tables, so no
    // normalization runs here and none has to be frozen.
    // DEC-479. Saved supervisors. The signature is stroke data in the same JSON form the consultant
    // and driver signatures already use, so it lives inside the database and every backup.
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS custom_directories (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        name_key TEXT NOT NULL,
        description TEXT,
        display_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_directories_name_key ON custom_directories(name_key);
      CREATE TABLE IF NOT EXISTS custom_directory_entries (
        id TEXT PRIMARY KEY NOT NULL,
        directory_id TEXT NOT NULL REFERENCES custom_directories(id),
        name TEXT NOT NULL,
        name_key TEXT NOT NULL,
        identifier TEXT,
        notes TEXT,
        display_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_directory_entries_name_key ON custom_directory_entries(directory_id, name_key);
      CREATE INDEX IF NOT EXISTS idx_custom_directory_entries_order ON custom_directory_entries(directory_id, is_active, display_order);
      CREATE TABLE IF NOT EXISTS supervisors (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        name_key TEXT NOT NULL,
        job_title TEXT,
        signature_json TEXT NOT NULL DEFAULT '[]',
        signature_updated_at TEXT,
        display_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_supervisors_name_key ON supervisors(name_key);
    `);
    currentVersion = 46;
  }


  await db.execAsync(`PRAGMA user_version = ${currentVersion}`);
}
