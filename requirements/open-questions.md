# Open Questions, Assumptions, and Risks

| ID | Type | Matter | Source turn | Status |
|---|---|---|---|---|
| OQ-001 | Open question | Which parts of asphalt-plant management are intended to be covered, and where is the system boundary? | Turn 1 | Open |
| OQ-002 | Open question | What activities and records are included in “everything”? | Turn 2 | Open |
| OQ-003 | Open question | Which reports are needed, by whom, and for which decisions? | Turn 2 | Open |
| OQ-004 | Assumption needing validation | Will the application replace paper records rather than supplement them? | Turn 2 | Open |
| RISK-001 | Risk | An unbounded goal of tracking and reporting “everything” may cause unclear scope and uncontrolled expansion. | Turn 2 | Open |
| OQ-005 | Open question | Does “private work” mean asphalt produced for the owner's own paving projects, and are external-customer sales also in scope? | Turn 3 | Closed in Turn 4: both own projects and external sales are in scope. |
| OQ-006 | Open question | How should jobs, paving days, batches, trucks, drivers, destinations, and fuel records relate to one another? | Turn 3 | Open |
| OQ-007 | Open question | Which batch, truck/driver, and fuel details must be recorded? | Turn 3 | Open |
| RISK-002 | Risk | Missing batch records may make production history and statistics incomplete or unreliable. | Turn 3 | Open |
| OQ-008 | Open question | What happens after final weighing? | Turn 6 | Partially resolved in Turn 7: two documents are created; payment handling remains open. |
| OQ-009 | Open question | Is net weight calculated as full weight minus empty weight, what is the source unit, and what conversion and rounding produce tons? | Turn 7 | Open |
| OQ-010 | Open question | Does external-sale scope include mix selection, pricing, payment, invoices/receipts, pickup or delivery, and customer access to history? | Turn 4 | Open |
| OQ-011 | Open question | What tolerance or corrective action applies when the loaded quantity differs from the customer's desired weight? | Turn 6 | Open |
| OQ-012 | Open question | What is the job title and responsibility of the person overseeing the plant during loading? | Turn 6 | Open |
| OQ-013 | Assumption needing validation | Each final weighbridge record will be linked to the customer, truck, and relevant production batch or batches. | Turn 6 | Open |
| OQ-014 | Open question | Is receipt total calculated as net tons multiplied by the selected price per ton, and how are payment method, amount paid, balance, and payment status handled? | Turn 8 | Open |
| OQ-015 | Open question | Which additional document fields are required, such as unique number, date/time, asphalt mix, project/order reference, issuer, and separate signatures? | Turn 7 | Open |
| OQ-016 | Open question | Who signs the delivery authorization, and are digital signatures or printed handwritten signatures required? | Turn 7 | Open |
| OQ-017 | Open question | How many copies are produced, who receives them, and must they be printable or shareable electronically? | Turn 7 | Open |
| OQ-018 | Open question | Who may change the price per ton, what does the change affect, and must changes be audited or approved? | Turn 8 | Partially closed in Turn 9: manager only; change becomes the future default until changed again. Audit remains open. |
| OQ-019 | Assumption needing validation | The manager cannot apply a one-transaction price override without also changing the future default. | Turn 9 | Open |
| OQ-020 | Open question | Which workflow steps differ between own and outside projects? | Turn 10 | Closed in Turn 11: no operational difference; owner's company is the customer for own projects. Internal payment treatment remains under OQ-022. |
| OQ-021 | Open question | What identifies an own project or outside project, and must every batch and truck load be linked to one? | Turn 10 | Open |
| OQ-022 | Open question | For an owner-project receipt, is the amount treated as an internal cost with no payment, or is an actual payment/status recorded? | Turn 11 | Closed in Turn 12: price may be left empty. |
| OQ-023 | Open question | Should own-project price be blank by default, and how should blank prices be represented in financial reports versus a zero price? | Turn 12 | Open |
| OQ-024 | Open question | What conversion settings, permissions, material/mix applicability, output units, precision, and rounding apply? | Turn 13 | Partially resolved in Turn 14: asphalt is 1,000 kg/ton and other conversion options must be selectable. |
| OQ-025 | Open question | What validations and correction history are required for manually entered empty and full weights? | Turn 13 | Open |
| RISK-003 | Risk | Manual weighbridge entry can introduce transcription errors that affect net weight, price, documents, and reports. | Turn 13 | Open |
| OQ-026 | Open question | Is concrete-batch production in scope for the current release, a future consideration, or only an example motivating flexible conversion? | Turn 14 | Closed in Turn 15: concrete is in the first version and uses the same workflow. |
| RISK-004 | Risk | Converting concrete weight to cubic metres without the correct density or mix-specific factor could produce inaccurate quantities. | Turn 14 | Open |
| OQ-027 | Open question | Should the user manually select the material and then have the system automatically apply that material's saved conversion and output unit? | Turn 15 | Closed in Turn 18: yes. |
| OQ-028 | Open question | Does the concrete conversion rate vary by mix, and who configures it? | Turn 15 | Open |
| OQ-029 | Open question | For concrete, are both the delivery authorization and receipt required, or is only one receipt/invoice produced? | Turn 15 | Open |
| OQ-030 | Open question | Who may add or change conversion-rate options? | Turn 19 | Closed in Turn 20: manager and authorized staff. Deletion behavior is intentionally not elaborated yet. |
| OQ-031 | Open question | What name, material, input/output units, rate, precision, and active status must each conversion option contain? | Turn 19 | Open |
| OQ-032 | Open question | Must issued receipts retain the originally selected conversion and calculated value if that saved rate is later changed? | Turn 19 | Open |
| OQ-033 | Open question | What do “category” and “item” represent, what examples exist, and who may create or edit them? | Turn 21 | Partially resolved in Turn 28: manager and authorized staff may manage them; semantics remain open. |
| OQ-034 | Open question | What is the end-to-end process and required record when a quarry truck delivers a purchased item? | Turn 21 | Partially resolved in Turns 26–29: direct quantity, quarry, item, driver, plate, and payment data are known; date/reference and inventory effect remain open. |
| OQ-035 | Open question | What unit and source apply to the directly recorded quarry quantity? | Turn 21 | Partially resolved in Turn 27: unit is cubic metres; source remains open. |
| OQ-036 | Open question | Which information about in-person payments must be tracked? | Turn 21 | Partially resolved in Turn 23: paid amount, payment date, remaining balance, and order paid/unpaid status are required. Allocation rules remain open. |
| OQ-037 | Open question | Should incoming quarry purchases update item inventory or only produce purchase and payment history? | Turn 21 | Closed in Turn 30: tracking only; no inventory update. |
| RISK-005 | Risk | Unbounded “all details” and freely configurable categories/items may create inconsistent data unless minimal required fields and behavior are defined. | Turn 21 | Open |
| OQ-038 | Open question | Can one order receive partial or multiple payments, and can one in-person payment cover several orders? | Turn 23 | Partially resolved in Turns 24–25: multiple dated partial payments are linked to one order; multi-order allocation remains open. |
| OQ-039 | Open question | How should total customer quantity be summarized when orders use different items or units? | Turn 23 | Open |
| OQ-040 | Open question | Who may add or edit categories, items, units, and their associations? | Turn 27 | Closed in Turn 28: manager and authorized staff. |
| OQ-041 | Open question | Is a foreman report created per project day, shift, event, or on demand? | Turn 32 | Closed in Turn 33: one report per project workday. |
| OQ-042 | Open question | Who is included under “who came,” and which identity/time details are recorded? | Turn 32 | Closed in Turn 36 for current scope: worker/driver name, truck plate, and machine name. |
| OQ-043 | Open question | Which report fields capture work performed, materials used, materials transported, quantities, machines, incidents, notes, and attachments? | Turn 32 | Partially resolved in Turns 34–37: presence and material fields defined; activity/incidents/notes/attachments remain open. |
| OQ-044 | Open question | Who can create, edit, approve, view, print, or export foreman reports? | Turn 32 | Partially resolved in Turn 38: manager/foreman can create and edit; no approval/lock; viewing/output remain open. |
| OQ-047 | Open question | Must edits to a daily report be recorded in an audit history? | Turn 38 | Open |
| OQ-045 | Open question | How is fuel stock added, measured, corrected, and reconciled, and how is current balance calculated? | Turn 32 | Partially resolved in Turns 39–40: balance is deliveries minus machine fills, but plant consumption is excluded; presentation/correction remains open. |
| OQ-046 | Open question | What machine details are required, and who may record a machine refuelling? | Turn 32 | Open |
| OQ-048 | Open question | Should the delivered-minus-machine balance be labeled estimated, and should users be able to enter a manual physical-stock adjustment? | Turn 40 | Closed in Turn 41: manual physical-tank correction is required. |
| RISK-006 | Risk | A fuel balance that excludes plant consumption may overstate actual physical stock and lead to misleading reports. | Turn 40 | Open |
| OQ-049 | Open question | What correction history and fields are retained for a manual fuel-balance adjustment? | Turn 41 | Open |
| OQ-050 | Open question | Are dashboard widget selections saved separately for each user or controlled globally by the manager? | Turn 44 | Closed in Turn 45: single owner-user chooses the dashboard. |
| OQ-051 | Open question | Which filters and time periods apply to each dashboard summary? | Turn 44 | Open |
| OQ-052 | Contradiction | Does the first version have only the owner's account, or do earlier references to authorized staff mean staff also require access? | Turn 45 | Closed in Turn 46: owner-only in version one; staff accounts deferred. |
| OQ-053 | Open question | Is version one for Android, iPhone, or both? | Turn 47 | Closed in Turn 48: both Android and iPhone. |
| OQ-054 | Open question | Which Bluetooth POS printer model/protocol and paper width must be supported? | Turn 47 | Partially resolved in Turns 49–51: current Xprinter uses 58 mm paper; exact model/protocol/printable width and additional target printers remain open. |
| OQ-057 | Open question | Is the current Xprinter's printer available to external Android/iPhone devices over Bluetooth, or only built into its Android POS terminal? | Turn 50 | Integration path remains open; Turn 52 confirms support for both this terminal and separate portable printers. |
| OQ-055 | Open question | What should happen when the printer is unavailable, unpaired, out of paper, or printing fails? | Turn 47 | Partially resolved in Turn 53: receipt remains saved and can be printed repeatedly while open; later reopening/reprint remains open. |
| OQ-058 | Open question | Can a saved receipt be reopened from history and reprinted after leaving the receipt screen? | Turn 53 | Closed in Turn 54: yes, with repeated printing allowed. |
| OQ-056 | Open question | Which exact paper widths constitute “all kinds of sizes” for version one? | Turn 49 | Open |
| RISK-007 | Risk | Generic Bluetooth printer compatibility across both Android and iPhone cannot be guaranteed without identifying printer protocols/models and supported widths. | Turn 49 | Open |
| OQ-059 | Open question | When internet returns, should offline changes synchronize automatically to cloud storage and any other owner device? | Turn 56 | Closed in Turn 57: yes. |
| OQ-060 | Open question | How should synchronization conflicts or failures be shown and resolved? | Turn 56 | Closed in Turn 69: failure retains/pends/retries; same-record conflict uses newest edit. |
| RISK-009 | Risk | Newest-edit-wins conflict handling can discard an older offline edit without manual review. | Turn 69 | Accepted for simplicity. |
| OQ-066 | Open question | Should direct receipt corrections retain the prior values, correction timestamp, and reason in a change history? | Turn 70 | Closed in Turn 71: keep only corrected values; no prior-value history. |
| RISK-010 | Risk | Direct correction without prior-value history reduces auditability and makes earlier printed copies impossible to reconcile from the system. | Turn 71 | Accepted for simplicity. |
| OQ-067 | Open question | Which totals, balances, customer summaries, and printed copies are recalculated after a receipt correction? | Turn 70 | Closed in Turn 72: all listed derived values and future prints recalculate. |
| OQ-068 | Open question | What happens if a corrected total is lower than payments already recorded, producing an overpayment? | Turn 72 | Closed in Turn 92: keep payments unchanged and display the difference as overpaid; no refund processing. |
| OQ-069 | Open question | Should accidentally deleted records be recoverable from a trash/recycle area, and for how long? | Turn 73 | Partially resolved through Turn 79: retained until manual permanent deletion; eligible record types remain open. |
| OQ-070 | Open question | What action makes a receipt confirmed and non-deletable, and can an unconfirmed draft receipt be deleted? | Turn 76 | Closed in Turn 78: explicit confirmation; drafts are editable/deletable. |
| OQ-072 | Open question | Does deleting a draft move it to trash or discard it, and is draft autosave required? | Turn 78 | Closed in Turn 94: drafts autosave and intentionally deleted drafts move to recoverable trash. |
| OQ-073 | Open question | Does every record follow Draft → Review → Confirm, and are all confirmed records non-deletable but directly correctable? | Turn 81 | Closed in Turn 83: applies to all business records; configuration settings save directly. |
| OQ-074 | Open question | Which record-specific range and cross-field validations are required before confirmation? | Turn 85 | Weight rules and the consolidated checkpoint were confirmed through Turn 87; price/payment rules remain open. |
| OQ-075 | Open question | Must a payment be positive, and may it exceed the linked order's remaining balance? | Turn 88 | Closed in Turn 90: payment must be positive and cannot exceed the remaining balance. |
| OQ-076 | Open question | What safeguard is required before permanent deletion from trash? | Turn 95 | Closed in Turn 95: show a warning and require explicit confirmation. |
| OQ-077 | Open question | How long shall synchronized confirmed records remain available for history and replacement-device restoration? | Turn 96 | Closed in Turn 97: all synchronized confirmed records remain permanently. |
| OQ-078 | Open question | When a category, item, unit, or conversion is no longer used, shall it be deactivated for new records while retained on historical records? | Turn 98 | Closed in Turn 99: deactivate for new selections, preserve historical display, and allow reactivation. |
| OQ-079 | Open question | Shall each confirmed receipt store its own permanent copy of the exact conversion name, units, rate, and calculated quantity used? | Turn 100 | Closed in Turn 101: store the permanent copy on every confirmed receipt. |
| OQ-080 | Open question | Does “invoice bill” mean a separate document layout from the receipt, or another name/format for the same document? | Turn 102 | Closed in Turn 104: receipt and invoice bill are the same document; only delivery authorization and receipt/invoice bill are required. |
| OQ-071 | Open question | Which missing or invalid fields prevent receipt confirmation, and can confirmation be undone? | Turn 77 | Open |
| OQ-061 | Open question | Which owner sign-in and account-recovery method shall protect synchronized data? | Turn 58 | Closed in Turn 60: email/password with secure email reset link. |
| OQ-062 | Open question | How long are synchronized backups retained, and can deleted or corrupted data be restored to an earlier point? | Turn 58 | Open |
| OQ-063 | Open question | How should the owner reset a forgotten password, and how long should an offline signed-in session remain usable? | Turn 59 | Closed in Turns 60–61: email reset link; session stays accessible offline after initial sign-in. |
| OQ-064 | Open question | Should the app support an optional device PIN, fingerprint, or Face ID lock and remote session revocation for a lost phone? | Turn 61 | Closed as corrected in Turn 64: no local biometric/PIN lock; password reset signs out other devices. |
| RISK-008 | Risk | Persistent offline access could expose business and customer data if an unlocked or compromised phone is lost. | Turn 61 | Partially mitigated in Turn 64 by password-reset session revocation; offline exposure before reconnection remains. |
| OQ-065 | Open question | Do all report types require PDF and Excel export, and which filters, columns, and layouts apply? | Turn 65 | Partially resolved in Turn 66: common filters confirmed; report-specific columns/layouts remain open. |
