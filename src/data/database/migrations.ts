import type { SQLiteDatabase } from 'expo-sqlite';

export const DATABASE_VERSION = 33;

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

  await db.execAsync(`PRAGMA user_version = ${currentVersion}`);
}
