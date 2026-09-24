export type SyncTable={table:string;rank:number};

export const syncTables:SyncTable[]=[
  {table:'categories',rank:10},{table:'measurement_units',rank:10},{table:'customers',rank:10},{table:'suppliers',rank:10},{table:'driver_profiles',rank:10},{table:'truck_profiles',rank:10},{table:'machine_profiles',rank:10},{table:'company_settings',rank:20},{table:'tax_settings',rank:20},{table:'fuel_price_history',rank:20},{table:'catalog_items',rank:20},{table:'conversion_options',rank:20},{table:'projects',rank:20},{table:'loads',rank:30},{table:'daily_project_reports',rank:30},{table:'quarry_purchases',rank:30},{table:'opening_balances',rank:30},{table:'waste_dumps',rank:30},{table:'quick_text_documents',rank:30},{table:'fuel_movements',rank:30},{table:'schedule_tasks',rank:30},{table:'pavement_calculations',rank:30},{table:'walls',rank:30},{table:'wall_consumptions',rank:40},{table:'waste_counter_presets',rank:30},{table:'project_issues',rank:30},{table:'project_media',rank:30},{table:'account_payments',rank:35},{table:'payment_entries',rank:40},{table:'load_drafts',rank:50},
];

// DEC-476. Workers now live in driver_profiles (the unified People table), so a person change and any
// worker change still queued from before the move both resolve to it; the push reads the row by id.
export const entityTable:Record<string,string>={category:'categories',catalogItem:'catalog_items',customer:'customers',companySettings:'company_settings',taxSettings:'tax_settings',fuelPrice:'fuel_price_history',measurementUnit:'measurement_units',conversionOption:'conversion_options',project:'projects',driverProfile:'driver_profiles',person:'driver_profiles',workerProfile:'driver_profiles',truckProfile:'truck_profiles',machineProfile:'machine_profiles',load:'loads',loadSignature:'loads',dailyProjectReport:'daily_project_reports',supplier:'suppliers',quarryPurchase:'quarry_purchases',openingBalance:'opening_balances',payment:'payment_entries',accountPayment:'account_payments',wasteDump:'waste_dumps',quickText:'quick_text_documents',fuelMovement:'fuel_movements',scheduleTask:'schedule_tasks',pavementCalculation:'pavement_calculations',wall:'walls',wallConsumption:'wall_consumptions',wasteCounter:'waste_counter_presets',projectIssue:'project_issues',projectPhoto:'project_media',loadDraft:'load_drafts'};

/**
 * DEC-479. Columns that never leave the device through the dormant cloud synchronisation, whatever
 * table they sit in: a Daily Report's supervisor sign-off carries saved signature strokes.
 */
export const DEVICE_ONLY_COLUMNS:Record<string,readonly string[]>={daily_project_reports:['supervisor_signoffs_json']};
export function cloudSafeRow(table:string,row:Record<string,unknown>|null):Record<string,unknown>|null{if(!row)return row;const hidden=DEVICE_ONLY_COLUMNS[table];if(!hidden)return row;const copy={...row};for(const column of hidden)delete copy[column];return copy;}

export const rankFor=(table:string)=>syncTables.find(value=>value.table===table)?.rank??999;
export const isSyncTable=(table:string)=>syncTables.some(value=>value.table===table);
