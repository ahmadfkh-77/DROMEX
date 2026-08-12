import type { SQLiteDatabase } from 'expo-sqlite';

const DATABASE_VERSION = 12;

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

  await db.execAsync(`PRAGMA user_version = ${currentVersion}`);
}
