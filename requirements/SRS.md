# Software Requirements Specification

## 1. Document Control

- Status: Initial draft
- Version: 0.95
- Last updated: 2026-08-06
- Interview status: In progress; core scope and lifecycle confirmed, with detailed workflows, interfaces, quality attributes, and success measures still being elicited

## 2. Purpose and Product Vision

The proposed product is a configurable plant-management system, not limited to asphalt and concrete. The business can define categories and items to track outgoing production/loads and incoming purchases such as quarry-truck deliveries. The intended outcome is centralized visibility into quantities, counterparties, payments, operational history, statistics, and reports. (Sources: Turns 1–4, 10, 15, and 21; status: Confirmed at a high level.)

## 3. Scope

### 3.1 In Scope

The system shall support user-defined categories and items. It shall record outgoing production and loads for the owner's own projects and outside customers and incoming purchases such as quarry-truck deliveries, including quantity and payment status. Asphalt and concrete are initial examples rather than fixed limits. (Sources: Turns 1–4, 10–12, 15, and 21; status: Confirmed at scope level.)

The first version is a single-user application for the owner. Staff accounts and multi-user permissions are deferred to a later release. (Sources: Turns 45–46; status: Confirmed.)

The first version shall be phone-first and shall print receipts using a compatible Bluetooth POS printer. (Source: Turn 47; status: Confirmed at capability level.)

### 3.2 Out of Scope

- Electronic payment collection, transfer, or processing. Payments occur in person; the system only records and tracks them. (Source: Turn 22; status: Confirmed.)
- Inventory or stock-balance updates derived from quarry deliveries. These records are for quantity and payment tracking only. (Source: Turn 30; status: Confirmed.)
- App-specific fingerprint, Face ID, or PIN locking in version one. (Source: Turn 62; status: Confirmed.)
- Payroll, wages, and employee-attendance management. (Source: Turn 249; status: Confirmed.)
- Equipment-maintenance scheduling. (Source: Turn 249; status: Confirmed.)
- Raw-material inventory balances other than the confirmed single fuel-tank balance. (Source: Turn 249; status: Confirmed.)
- Plant-machine control, automated weighbridge integration, and GPS truck tracking. (Source: Turn 249; status: Confirmed.)
- Customer or supplier login portals, online ordering, and electronic payment processing. (Sources: Turns 22 and 249; status: Confirmed.)
- Full accounting and government tax-filing functionality. (Source: Turn 249; status: Confirmed.)

### 3.3 Future Considerations

Additional workflows beyond outgoing loads and incoming purchases remain to be elicited.

- Staff accounts, role-based permissions, and multi-user operation may be added after the first release. (Source: Turn 46; status: Deferred.)

## 4. Definitions and Domain Vocabulary

- Asphalt plant: The interviewee's business facility; its operating model and domain terminology remain to be elicited.
- Asphalt: An in-scope material measured from kilograms and reported in tons using 1,000 kg = 1 ton.
- Concrete: An in-scope material weighed in kilograms and reported as a converted volume in cubic metres using a configurable conversion rate.
- Category: A user-defined grouping whose business meaning and behavior remain to be clarified.
- Item: A user-defined trackable product, material, or record type associated with a category; exact semantics remain to be clarified.
- Quarry purchase: An incoming material purchase delivered by one or more trucks and tracked for quantity, payment, and history.

## 5. Stakeholders and User Classes

- Plant owner/manager/project foreman: The interviewee currently performs all three roles, needs plant-wide visibility, controls default pricing, and creates/edits project daily reports. (Sources: Turns 2, 9, 32, and 38; status: Confirmed.)
- Other user classes: To be elicited.
- Individual asphalt customers: People who obtain asphalt from the plant. Their direct system access is unknown. (Source: Turn 4; status: Confirmed stakeholder class.)
- Company asphalt customers: External companies that obtain asphalt and require a quantity history. Their direct system access is unknown. (Source: Turn 4; status: Confirmed stakeholder class.)
- Plant/batch operator: Produces asphalt batches for loading. System interaction is unknown. (Source: Turn 6; status: Draft user class.)
- Wheel-loader operator: Feeds material to the plant. System interaction is unknown. (Source: Turn 6; status: Draft user class.)
- Plant oversight role: Observes or supervises plant activity during loading; exact title and duties are unknown. (Source: Turn 6; status: Draft stakeholder class.)
- Truck driver: Brings the truck through empty weighing, loading, and loaded weighing. Truck ownership and system interaction are unknown. (Source: Turn 6; status: Draft stakeholder class.)
- Weighbridge personnel or recordkeeper: Records truck weights; the responsible role has not been explicitly identified. (Source: Turn 6; status: Assumed stakeholder class.)
- Project foreman: Creates reports describing project work, attendance, and material use or transport. (Source: Turn 32; status: Confirmed user class.)
- Application user: The owner is the only application user in the first version. Other people are represented in records but do not have accounts. (Sources: Turns 45–46; status: Confirmed.)
- Future staff users: Staff accounts may be introduced after version one. Roles and permissions are deferred. (Source: Turn 46; status: Deferred.)

## 6. Context and Current-State Process

The plant currently uses paper and books for management and recordkeeping. This limits the owner's ability to see plant information comprehensively and obtain reports. The detailed workflows and paper records remain to be elicited. (Source: Turn 2; status: Confirmed.)

Some production batches are not recorded, so no complete batch history exists. There is no tracked history linking truck drivers to paving days, no operational statistics, and fuel is recorded on paper. (Source: Turn 3; status: Confirmed.)

The plant mainly produces asphalt for the owner's projects. Individuals and companies also sometimes request asphalt; the owner wants their quantities and histories recorded. (Source: Turn 4; status: Confirmed.)

For an outside-customer collection, a truck is first weighed empty. It proceeds to the plant, where one person produces the batch, a wheel-loader operator feeds material to the plant, and another person oversees activity. The truck is loaded based on the customer's desired weight and then returns to the weighbridge for its loaded weight to be recorded. The subsequent document, customer, and payment steps are unknown. (Source: Turn 6; status: Confirmed through final weighing.)

After final weighing, two documents are required: a delivery authorization and a receipt, with the receipt also referred to as the invoice bill. There is no third invoice document. The delivery authorization contains the company name and configured contact details, driver name, plate number, empty weight, full weight, net weight, converted quantity and output unit, destination address, and a signature. It omits the conversion name/rate/formula and all financial details. The receipt/invoice bill contains net weight and price. Both documents can be printed, generated as PDF, and sent from the phone. (Sources: Turns 7, 102–104, and 256–257; status: Confirmed at document-set level.)

This workflow applies to both outside work and the owner's projects. For an owner project, the owner's company is recorded as the customer. (Sources: Turns 10–11; status: Confirmed.)

Concrete follows the same basic workflow and final two-document setup as asphalt: empty truck weighing, loading, full truck weighing, record creation, a delivery authorization, and a receipt/invoice bill. (Sources: Turns 15 and 104; status: Confirmed.)

The business also buys materials from a quarry. Each quarry truck and its quantity, payment status, and related details must be recorded and available historically. The current paper workflow remains to be elicited. (Source: Turn 21; status: Confirmed at scope level.)

The business also needs fuel-stock tracking and project work reporting. Fuel issues are associated with machines and quantities. A foreman records project activity, attendees, and material use or transport. (Source: Turn 32; status: Confirmed at scope level.)

## 7. Product Overview and System Boundary

The proposed product is an asphalt-plant management application intended to centralize information currently kept in paper records and expose reports to the owner. Its boundary relative to production controls and broader business operations remains open. (Sources: Turns 1–2; status: Draft.)

## 8. Assumptions and Dependencies

- Whether the application will replace or supplement paper records requires confirmation.

## 9. Functional Requirements

### FR-001
- Statement: “The system shall maintain digital records for every in-scope asphalt load and project activity, including the owner's projects and outside projects or customers.”
- Rationale: Plant management currently relies on paper and books.
- Actors: Plant owner; other record-entry actors to be identified.
- Trigger: An in-scope plant event or record must be captured or updated.
- Preconditions: The applicable workflow and authorized actor are known.
- Main behavior: Store and make available a digital record of the event or information.
- Alternate and exception behavior: To be elicited.
- Postconditions: The plant record is available digitally.
- Priority: Must
- Acceptance criteria: Records can be retrieved for both the owner's projects and outside projects/customers; detailed completeness criteria remain to be defined.
- Source: Interview turns 2 and 10
- Status: Confirmed at scope level

### FR-002
- Statement: “The system shall provide the plant owner with reports derived from the digital plant records.”
- Rationale: The owner wants reports covering plant operations.
- Actors: Plant owner.
- Trigger: The owner requests or accesses a report.
- Preconditions: Relevant records exist in the system.
- Main behavior: Present a report based on selected plant information.
- Alternate and exception behavior: Behavior for incomplete or unavailable data is to be elicited.
- Postconditions: The owner can view the requested report.
- Priority: Must
- Acceptance criteria: Deferred until report types, contents, filters, timeliness, and output formats are identified.
- Source: Interview turn 2
- Status: Draft

### FR-003
- Statement: “The system shall maintain a history of recorded asphalt production batches.”
- Rationale: Some batches are currently unrecorded, leaving no production history.
- Actors: Plant personnel responsible for production records; exact role to be identified.
- Trigger: A truck-load/business-record draft is confirmed.
- Preconditions: The load passes confirmation validation and represents exactly one production batch.
- Main behavior: Use the same underlying load record as the production-batch record and expose it as one entry in the unified Load History without separate batch entry or a separate Batch History screen.
- Alternate and exception behavior: Corrections to the shared record update both history views. A separate duplicate batch record shall not be created.
- Postconditions: The batch can be retrieved in historical records and used in statistics.
- Priority: Must
- Acceptance criteria: Confirming one truck load creates one underlying batch/load record visible in Load History; no separate Create Batch form, separate Batch History screen, or duplicate record is required. Opening the entry shows the complete transaction and both documents.
- Source: Interview turn 3
- Status: Confirmed association, creation behavior, and unified history; summary fields pending

### FR-004
- Statement: “The system shall record which truck and driver participated in each paving day.”
- Rationale: The plant currently has no such tracking history.
- Actors: Dispatch or operational personnel; exact role to be identified.
- Trigger: A truck and driver are assigned to or participate in a paving day.
- Preconditions: The paving day, truck, and driver can be identified.
- Main behavior: Associate the truck and driver with the paving-day record.
- Alternate and exception behavior: Driver or truck changes and multiple trips remain to be elicited.
- Postconditions: The assignment or participation is available in history and reports.
- Priority: Must
- Acceptance criteria: A selected paving day shows its participating trucks and drivers; further details remain to be confirmed.
- Source: Interview turn 3
- Status: Draft

### FR-005
- Statement: “The system shall maintain digital fuel records for in-scope plant operations.”
- Rationale: Fuel is currently recorded only on paper.
- Actors: Personnel who issue or record fuel; exact role to be identified.
- Trigger: An in-scope fuel transaction or reading occurs.
- Preconditions: The relevant asset, activity, or storage source can be identified as required.
- Main behavior: Store the fuel record digitally.
- Alternate and exception behavior: Corrections, missing readings, and discrepancies remain to be elicited.
- Postconditions: The fuel record is retained and available for reporting.
- Priority: Must
- Acceptance criteria: Required fuel fields and reconciliation rules remain to be elicited.
- Source: Interview turn 3
- Status: Draft

### FR-006
- Statement: “The system shall maintain a record of asphalt supplied to each external individual or company customer.”
- Rationale: External customers obtain asphalt, and their quantities need to be recorded.
- Actors: Plant personnel responsible for external customer transactions; exact role to be identified.
- Trigger: Asphalt is supplied to an external customer.
- Preconditions: A customer profile with required type and name exists or can be created.
- Main behavior: Require selection of a saved customer profile and associate the supplied quantity with that customer's transaction record. Provide quick Add Customer inside receipt entry when a new profile is needed.
- Alternate and exception behavior: Duplicate, anonymous, or one-time customer handling, corrections, cancelled orders, and returns remain to be elicited.
- Postconditions: The transaction contributes to the customer's history.
- Priority: Must
- Acceptance criteria: A receipt cannot confirm with only free-text customer text. Selecting an existing profile or completing quick Add Customer provides the persistent customer association visible in history.
- Source: Interview turn 4
- Status: Confirmed association and creation behavior; duplicate handling pending

### FR-007
- Statement: “The system shall provide an authorized user with the historical asphalt quantities recorded for an external customer.”
- Rationale: The owner wants individuals and companies to have a transaction history.
- Actors: Plant owner; other authorized users and any customer access remain to be identified.
- Trigger: An authorized user opens a customer's history.
- Preconditions: A customer profile exists; it may have zero or more recorded transactions.
- Main behavior: Display the customer's recorded asphalt-supply transactions and quantities.
- Alternate and exception behavior: A customer with no transactions displays an empty history. Duplicate-customer handling remains to be elicited.
- Postconditions: The customer's history is available for review.
- Priority: Must
- Acceptance criteria: A customer's history lists every recorded asphalt-supply transaction and quantity associated with that customer.
- Source: Interview turn 4
- Status: Draft

### FR-008
- Statement: “The system shall record the empty and loaded weighbridge measurements for each truck load, whether for an owner project or an outside customer.”
- Rationale: The truck is weighed before and after loading to establish the supplied amount.
- Actors: Weighbridge personnel or another authorized recordkeeper.
- Trigger: A customer truck is weighed before loading or after loading.
- Preconditions: The truck collection can be identified.
- Main behavior: Accept manual entry of empty and full weights as whole kilograms and store both measurements as part of the load record.
- Alternate and exception behavior: Missing measurements, reweighing, corrections, weighbridge failure, and multiple loads remain to be elicited.
- Postconditions: The collection record contains the available pre-load and post-load weights.
- Priority: Must
- Acceptance criteria: An authorized user can manually enter and later retrieve whole-kilogram empty and full weights for a completed truck load; decimal-kilogram entries are rejected.
- Source: Interview turns 6, 10–11, and 13
- Status: Confirmed at workflow level

### FR-009
- Statement: “The system shall record the desired asphalt weight for each applicable truck load.”
- Rationale: Loading is performed based on the weight requested by the customer.
- Actors: Personnel accepting or fulfilling the project or customer request; exact role to be identified.
- Trigger: A desired amount of asphalt is specified for a load.
- Preconditions: The associated own project or outside project/customer is identifiable.
- Main behavior: Store and display the desired quantity as an informational value for comparison with the actual measured net quantity.
- Alternate and exception behavior: A difference does not block confirmation and does not trigger a threshold or warning. Changes, maximum truck capacity, and invalid requests remain to be elicited.
- Postconditions: The target and variance remain associated with the relevant project/customer, while billing uses actual measured quantity.
- Priority: Must
- Acceptance criteria: A collection record shows requested and actual quantities for comparison. A differing quantity can be confirmed and bills the actual measured amount without a variance warning.
- Source: Interview turns 6 and 10
- Status: Confirmed

### FR-010
- Statement: “The system shall generate one delivery authorization for every completed truck load and item, whether for an owner project or an outside customer.”
- Rationale: The delivery authorization is one of two required documents after loading.
- Actors: Authorized plant personnel; recipient and issuer roles remain to be identified.
- Trigger: The truck has completed final weighing and the load record is ready for authorization.
- Preconditions: Required customer, driver, vehicle, weight, destination, and signature information is available.
- Main behavior: Generate a delivery authorization containing the snapshotted company header with configured contact details beneath the company name, document title, automatic shared transaction number and original date/time, customer and applicable project or destination, item, driver name, plate number, optional requested quantity when entered, empty weight, full weight, net weight, calculated converted quantity with its output unit, destination address, and optional driver signature. Omit the requested-quantity label and value when blank. Use colon-separated `Label: Value` fields. Render a compact primarily single-column 58 mm template and a more spacious aligned 80 mm template with identical applicable information. Show no selected conversion name, conversion rate/formula, unit price, subtotal, VAT, payment, or total values.
- Alternate and exception behavior: Missing data, corrections, reprints, cancellations, and voiding remain to be elicited.
- Postconditions: The authorization is associated with exactly one truck load, one item, and its corresponding receipt and is available in the required output form.
- Priority: Must
- Acceptance criteria: A generated authorization displays all applicable operational fields with values from the correct load, shows the converted result and output unit without its conversion name/rate/formula, omits a blank requested quantity, identifies the driver as signer, shows the same automatic transaction number as its corresponding receipt, contains no monetary values, and can be sent to the customer as PDF.
- Source: Interview turns 7, 10–11, and 256–258
- Status: Confirmed field split as corrected

### FR-011
- Statement: “The system shall generate one receipt for every completed truck load and item, whether for an owner project or an outside customer.”
- Rationale: A receipt showing net weight and price is required after loading.
- Actors: Authorized plant personnel; recipient and issuer roles remain to be identified.
- Trigger: The load's net weight and applicable price are available.
- Preconditions: The completed load is identifiable.
- Main behavior: Generate a minimal receipt containing the snapshotted company header, document title, automatic shared transaction number and original date/time, customer name, project name when selected, final/net weight, unit price, subtotal, VAT rate and amount, and final total. Use colon-separated `Label: Value` fields in both the compact 58 mm and spacious 80 mm templates. Internally round converted quantity to the selected conversion's displayed decimal places for billing, but do not print conversion details or billed converted quantity. Always omit driver, plate, requested quantity, empty/full weights, destination, signature, and payment/balance information.
- Alternate and exception behavior: Omit project when none is selected. Blank and intentional zero prices are permitted for own-company and outside-customer receipts: blank displays Unpriced without VAT/total, while zero displays the applicable zero-value financial lines. Reprints and corrections are covered elsewhere.
- Postconditions: The receipt is associated with exactly one truck load, one item, and its corresponding delivery authorization and is available in the required output form.
- Priority: Must
- Acceptance criteria: Every completed load can produce a receipt showing its customer, applicable project, net weight, financial/VAT lines, and the same automatic transaction number as its delivery authorization while omitting operational and payment details. If a conversion result of 7.3486 is configured for three displayed decimals, billing uses 7.349; at $90 per unit subtotal displays $661.41 before applicable VAT, without printing the conversion detail. Any receipt can be confirmed with a blank price or an intentional $0.00 price under their established display rules.
- Source: Interview turns 7 and 10–12
- Status: Confirmed field split

### FR-012
- Statement: “The system shall allow the owner to set or change the default price per output unit used for priced transactions.”
- Rationale: The applicable price per output unit may vary.
- Actors: Plant owner/manager.
- Trigger: The owner edits a default price in the dedicated price-settings section.
- Preconditions: The authenticated user has the manager role.
- Main behavior: Accept the new default price per output unit and present it on subsequent applicable receipts until the owner changes the setting again.
- Alternate and exception behavior: Invalid prices and audit behavior remain to be elicited. Receipt-level overrides are handled separately and do not modify this setting.
- Postconditions: The new default price per output unit is retained and presented for subsequent applicable sales.
- Priority: Must
- Acceptance criteria: Each item can retain a distinct default price per output unit. Changing an item's default in the dedicated settings section changes the initially presented price on later receipts for that item; overriding a price inside one receipt does not change the saved item default.
- Source: Interview turns 8–9
- Additional source: Interview turns 112–113
- Status: Confirmed

### FR-053
- Statement: “The system shall allow the owner to override the price per output unit for one receipt without changing the saved default price.”
- Rationale: A particular customer or order may use a special price while later receipts should return to the configured default.
- Actors: Owner.
- Trigger: The owner edits the price shown while preparing a receipt.
- Preconditions: A priced receipt is in draft and a default price is available.
- Main behavior: Apply the edited price only to the current receipt and calculate its total using that overridden value; later receipts return to the selected item's saved default.
- Alternate and exception behavior: Changing the persistent default requires the dedicated price-settings section.
- Postconditions: The receipt retains its transaction price, and a subsequent receipt presents the unchanged saved default.
- Priority: Must
- Acceptance criteria: With a saved default of $70 per unit, changing one draft receipt to $65 uses $65 for that receipt; starting the next applicable receipt presents $70.
- Source: Interview turns 110–113
- Status: Confirmed

### FR-054
- Statement: “The system shall distinguish an unpriced receipt from an intentionally zero-priced receipt.”
- Rationale: A missing price and a deliberate free transaction represent different business facts.
- Actors: Owner; system.
- Trigger: A receipt is confirmed with a blank or $0.00 price.
- Preconditions: The receipt otherwise passes confirmation validation.
- Main behavior: Label a blank price as Unpriced, give it no payment balance, and exclude it from financial totals. Include an intentional $0.00 price as a zero-value order with no payment due.
- Alternate and exception behavior: A later direct correction may change blank, zero, or positive price and shall recalculate dependent totals and status.
- Postconditions: Customer balances and financial reports distinguish missing prices from intentional zero values.
- Priority: Must
- Acceptance criteria: An unpriced receipt is labeled Unpriced and omitted from summed revenue; a $0.00 receipt appears in order history as a zero-value order with no amount due.
- Source: Interview turns 124–125
- Status: Confirmed

### FR-055
- Statement: “The system shall automatically assign each truck load a transaction number that remains unique when records are created offline on multiple devices.”
- Rationale: Both documents must remain traceable to one load without duplicate or changed identifiers after synchronization.
- Actors: System.
- Trigger: A valid truck-load draft is explicitly confirmed.
- Preconditions: The device has an assigned device code and maintains its local sequence; the draft passes confirmation validation.
- Main behavior: At confirmation, generate a number combining local confirmation date, device code, and device-local sequence, such as 20260807-A-00123; capture the original confirmation date/time; and display both on the delivery authorization and receipt.
- Alternate and exception behavior: Offline creation shall not require a server-assigned number. Synchronization shall not renumber the transaction. Deleted draft numbers and confirmed transaction numbers shall never be reused.
- Postconditions: Both documents share one immutable identifier and original confirmation date/time that remain stable across owner devices.
- Priority: Must
- Acceptance criteria: Create transactions offline on two devices on the same date and verify that their numbers differ; synchronize them and verify neither number changes; verify both documents for each load show its same number.
- Source: Interview turns 136–138
- Status: Confirmed

### FR-056
- Statement: “The system shall capture the driver's digital signature on the phone and retain it with the transaction.”
- Rationale: The owner needs signed transaction history and signed printable/shareable documentation.
- Actors: Driver; owner.
- Trigger: The driver signs before confirmation or the owner adds a signature to a confirmed unsigned transaction later.
- Preconditions: The transaction exists and the phone supports touch input.
- Main behavior: Present a drawing area, allow the driver to sign with a finger, store the current drawing with the transaction, include it on every printed/PDF delivery authorization only, and display Signed on the shared transaction in history.
- Alternate and exception behavior: Signature is optional at confirmation. An unsigned transaction may remain unsigned indefinitely or receive a signature later. The owner may clear and replace an incorrect or unreadable stored drawing, including after confirmation. No signature-change log or prior drawing is retained. The receipt does not display the signature.
- Postconditions: The transaction is visibly identified as Signed when it has a stored signature and Unsigned otherwise.
- Priority: Must
- Acceptance criteria: A transaction can be confirmed without a signature and history shows Unsigned. A signature can be added later, after which history shows Signed and every subsequent delivery-authorization print/PDF includes it. The owner can clear it to return the transaction to Unsigned and capture a replacement; the linked receipt never displays it.
- Source: Interview turns 141–142
- Status: Confirmed

### FR-057
- Statement: “The system shall provide a unified Load History with one summary entry per confirmed batch/load transaction.”
- Rationale: The owner needs a clear history of completed loads without separate batch and load lists.
- Actors: Owner.
- Trigger: The owner opens Load History or selects an entry.
- Preconditions: Zero or more confirmed load transactions exist.
- Main behavior: List transaction number/date, customer, applicable project, item and quantity, truck plate, Signed/Unsigned state, and payment status. Selecting an entry opens all remaining transaction details, its delivery authorization, and receipt.
- Alternate and exception behavior: An empty history displays a clear empty state; filtering remains covered by applicable report/history requirements.
- Postconditions: The owner can identify and open any confirmed load transaction and its documents.
- Priority: Must
- Acceptance criteria: Each confirmed batch/load appears exactly once with all confirmed summary fields; selecting it opens the matching full transaction and both documents.
- Source: Interview turns 155–156
- Status: Confirmed

### FR-058
- Statement: “The system shall calculate receipt and priced quarry-purchase VAT using a universal percentage configured in tax settings.”
- Rationale: The owner needs VAT added consistently to numeric-priced sales and purchases using a centrally managed rate.
- Actors: Owner; system.
- Trigger: The owner changes the VAT setting or the system calculates a receipt or priced quarry-purchase total.
- Preconditions: A valid universal VAT percentage is configured and the transaction's pricing state is known.
- Main behavior: Calculate a subtotal from quantity and price per unit. For every numeric-priced receipt or quarry purchase, calculate VAT using the universal configured percentage and add it to produce the final total. Show subtotal, VAT rate, VAT amount, and final total.
- Alternate and exception behavior: A $0.00 transaction has $0.00 VAT. An Unpriced receipt or quantity-only quarry purchase has no VAT calculation. A confirmed transaction retains its applied VAT rate after tax-setting changes and uses that retained rate when corrected/recalculated.
- Postconditions: Applicable confirmed receipts and purchases permanently retain their VAT rate, VAT amount, subtotal, and final total.
- Priority: Must
- Acceptance criteria: A positive numeric receipt or quarry purchase shows subtotal, configured VAT rate, VAT amount, and final total; a $0.00 transaction shows $0.00 VAT; an Unpriced transaction has no VAT; changing the tax setting affects subsequent transactions but not the rate stored on an existing confirmed transaction.
- Source: Interview turns 158–159 and 174
- Status: Confirmed

### FR-059
- Statement: “The system shall require each receipt to reference a saved customer profile and provide quick customer creation during receipt entry.”
- Rationale: Customer histories and balances require one persistent customer identity rather than repeated free text.
- Actors: Owner.
- Trigger: The owner selects or adds a customer while creating a receipt.
- Preconditions: A receipt draft is open.
- Main behavior: Search/select an existing profile or open a quick Add Customer form, save the valid new profile, and return it as the selected receipt customer.
- Alternate and exception behavior: Free-text-only customer input cannot satisfy confirmation. When a new profile matches an existing name, phone number, or Tax/VAT number, show possible matches and a warning; the owner may continue after review and may keep profiles separate. Existing duplicates may be merged through FR-060.
- Postconditions: The receipt is associated with one saved customer profile and contributes to that profile's history.
- Priority: Must
- Acceptance criteria: The owner can add a new customer without abandoning the draft; the created profile becomes selected; confirmation is blocked until one saved profile is selected. Matching name, phone, or Tax/VAT number displays existing profiles and a warning but does not absolutely block creation.
- Source: Interview turn 160
- Status: Confirmed

### FR-060
- Statement: “The system shall allow the owner to optionally merge duplicate customer profiles through a safeguarded manual workflow.”
- Rationale: Accidental duplicates split histories and balances, while legitimate same-name customers must remain separable.
- Actors: Owner.
- Trigger: The owner selects Merge Customers.
- Preconditions: Two distinct customer profiles exist.
- Main behavior: Select the retained and duplicate profiles; preview affected receipts, payments, balances, and totals; explicitly confirm; move transaction associations to the retained profile; recalculate its summary; and archive the duplicate as Merged into the retained profile.
- Alternate and exception behavior: Cancelling changes nothing. The owner may keep possible duplicates separate. Previously issued document contents are not rewritten by the merge.
- Postconditions: The retained profile owns the consolidated associations and summary; the duplicate cannot be selected for new receipts and identifies its retained profile.
- Priority: Must
- Acceptance criteria: Cancelling the preview leaves profiles unchanged. Confirming moves all associated history and recalculates totals, archives the duplicate with a merged-into reference, and leaves issued document content unchanged.
- Source: Interview turns 161–163
- Status: Confirmed

### FR-061
- Statement: “The system shall maintain saved quarry/supplier profiles and their purchase/payment histories.”
- Rationale: Incoming-delivery quantities and balances must be traceable to persistent suppliers.
- Actors: Owner.
- Trigger: The owner creates/selects a supplier or opens supplier history.
- Preconditions: None for creation; a saved profile exists for history.
- Main behavior: Require supplier name; optionally retain phone, email, address, Tax/VAT number, and notes; provide quick creation during quarry-delivery entry; list associated purchase and payment records.
- Alternate and exception behavior: Duplicate-supplier handling remains to be defined.
- Postconditions: Quarry deliveries reference a saved supplier and contribute to its history.
- Priority: Must
- Acceptance criteria: A new supplier can be created without abandoning a delivery draft, becomes selected, and later displays that confirmed delivery and its payment state in supplier history.
- Source: Interview turn 170
- Status: Confirmed; duplicate handling pending

### FR-062
- Statement: “The system shall track payments for a priced quarry purchase using the same rules as customer-order payments.”
- Rationale: Supplier balances require the same traceable partial-payment behavior as customer balances.
- Actors: Owner.
- Trigger: The owner records, corrects, or cancels a payment for a priced quarry purchase.
- Preconditions: The purchase has a numeric final total.
- Main behavior: Create separate dated partial-payment entries linked to exactly one purchase; derive paid amount, remaining balance, and Unpaid/Partially Paid/Paid/Overpaid status; apply confirmed payment validation and cancellation rules.
- Alternate and exception behavior: An unpriced quantity-only purchase has no payment balance or payment entries.
- Postconditions: Supplier purchase history and summary reflect active payments and exclude cancelled payments.
- Priority: Must
- Acceptance criteria: Multiple valid partial payments update one purchase's balance/status; an excessive payment is blocked; cancellation remains visible but no longer contributes; an unpriced purchase does not expose payment entry.
- Source: Interview turn 179
- Status: Confirmed

### FR-013
- Statement: “The system shall associate each recorded asphalt load with either an owner project or an outside project/customer.”
- Rationale: All work in both categories must be recorded and distinguishable in history.
- Actors: Authorized operational personnel; exact roles remain to be identified.
- Trigger: A load record is created.
- Preconditions: The relevant customer is known; when applicable, a saved project with required identity fields exists.
- Main behavior: Require every load to select a customer. If the customer is the owner's company, also require a saved project. For an outside customer, allow an optional saved project and otherwise use the load's destination address.
- Alternate and exception behavior: An own-company load without a project cannot be confirmed. An outside-customer load without a project may be confirmed when its required destination is present. Mixed-purpose and corrected associations remain to be elicited.
- Postconditions: The load appears in the correct project or customer history.
- Priority: Must
- Acceptance criteria: An own-company load cannot confirm without a selected saved project. An outside-customer load can confirm without a project when it has a destination. All loads appear in the selected customer's history, and project-linked loads also appear in project history.
- Source: Interview turn 10
- Status: Confirmed

### FR-014
- Statement: “The system shall calculate net weight in kilograms as full weight minus empty weight.”
- Rationale: Net supplied asphalt weight must be derived from the two manually entered weighbridge readings.
- Actors: System; authorized record-entry user.
- Trigger: Both empty and full weights are entered or changed.
- Preconditions: Both readings are present as whole kilograms and pass applicable validation.
- Main behavior: Subtract empty weight from full weight and present the resulting net weight in kilograms.
- Alternate and exception behavior: Missing, equal, or lower full weight and corrections remain to be defined.
- Postconditions: The calculated net weight is available to documents, history, reports, and pricing.
- Priority: Must
- Acceptance criteria: For an empty weight of E kg and full weight of F kg, the displayed net weight equals F − E kg.
- Source: Interview turn 13
- Status: Confirmed

### FR-015
- Statement: “The system shall convert calculated net kilograms using the saved conversion option manually selected while preparing the receipt.”
- Rationale: Asphalt is reported in tons, while other material contexts such as concrete may be reported in cubic metres.
- Actors: System; configuration actor to be identified.
- Trigger: The receipt preparer selects a saved conversion option.
- Preconditions: A valid conversion rule and output unit are selected.
- Main behavior: Show all active saved conversion rates in a dropdown without filtering by selected item. Display each option's name, input/output units, and rate; apply the option manually selected by the owner and present the result using that option's configured decimal places. The asphalt option uses 1,000 kg = 1 ton and displays three decimal places so each whole kilogram is preserved exactly.
- Alternate and exception behavior: Behavior without a conversion, invalid configuration, and changes affecting historical records remain to be defined.
- Postconditions: The converted quantity is available to documents, history, reports, and pricing.
- Priority: Must
- Acceptance criteria: Every active conversion appears regardless of selected item and visibly identifies its name, input/output units, and rate. The receipt uses the manually chosen option; choosing the asphalt 1,000 kg/ton option displays 20.555 tons for 20,555 net kg rather than rounding it to 20.56 tons.
- Additional source: Interview turn 102
- Source: Interview turns 13–14 and 18–19
- Status: Confirmed behavior, option display, and configurable precision; rounding method pending

### FR-016
- Statement: “The system shall record whether each load contains asphalt or concrete.”
- Rationale: Both materials are in scope and require different converted units and rates.
- Actors: Authorized record-entry user.
- Trigger: A new load record is created.
- Preconditions: The material to be loaded is known.
- Main behavior: Present a manual material choice and associate it with the load. Conversion is selected separately while preparing the receipt.
- Alternate and exception behavior: Material changes after weighing and future materials remain to be defined.
- Postconditions: The load is identifiable as asphalt or concrete.
- Priority: Must
- Acceptance criteria: Every completed load identifies exactly one material, independently of the receipt's selected conversion option.
- Source: Interview turns 15–18
- Status: Confirmed as corrected in Turn 19

### FR-017
- Statement: “The system shall allow authorized users to add saved conversion-rate options.”
- Rationale: Receipt preparers need to choose a conversion rate suited to the load.
- Actors: Owner.
- Trigger: A required conversion option is not available or must be configured.
- Preconditions: The user is the manager or has been authorized to manage conversion options and knows the rate and units.
- Main behavior: Save a reusable conversion option containing its name, input unit, output unit, rate, displayed decimal places, and active state for later receipt selection.
- Alternate and exception behavior: Duplicate, invalid, edited, deactivated, or deleted rates and historical impact remain to be defined.
- Postconditions: The option is available for permitted receipt workflows.
- Priority: Must
- Acceptance criteria: The owner can add or change a valid conversion option, including its displayed decimal places, and subsequently select it while preparing a receipt.
- Source: Interview turns 19–20 and 46
- Status: Confirmed for version one

### FR-018
- Statement: “The system shall allow an authorized user to create and name categories.”
- Rationale: The system must support business-defined tracking areas beyond asphalt and concrete.
- Actors: Owner.
- Trigger: The business needs a category that does not yet exist.
- Preconditions: The user has permission.
- Main behavior: Create and retain a named category.
- Alternate and exception behavior: Duplicate names, editing, deactivation, and deletion remain to be defined.
- Postconditions: The category is available for item organization.
- Priority: Must
- Acceptance criteria: The owner can create a named category and later select it when defining an item.
- Source: Interview turns 21, 28, and 46
- Status: Confirmed behavior; lifecycle pending

### FR-019
- Statement: “The system shall allow an authorized user to create and name items within a category.”
- Rationale: The owner needs to define what the business tracks.
- Actors: Owner.
- Trigger: A required item does not yet exist.
- Preconditions: The target category exists and the user has permission.
- Main behavior: Maintain one shared Item Catalog. Require item name, category, and at least one enabled usage area of Loads, Quarry Purchases, and/or Daily Reports. Optionally retain internal code, description/notes, default unit, and default receipt price when Loads is enabled. New items start Active. Filter each workflow to active items enabled for it, while allowing one item record to serve multiple areas. Provide Quick Add Item within all three workflows; saving immediately selects the new item. Receipt conversion remains separately selected and is not stored as an item default.
- Alternate and exception behavior: At confirmation, snapshot the selected item's name, optional internal code, category, and unit. Later catalog edits or category movement affect only future entries and never alter confirmed documents or reports. An item referenced by any record cannot be deleted and may only be deactivated; a never-used item may move to restorable Trash. Deactivation hides it from new selections while retaining history and allowing reactivation. Reject a duplicate nonblank internal code. Warn without blocking when the name matches or closely resembles an existing item, show the possible match, and allow an intentionally distinct item to be saved.
- Postconditions: The item is available for applicable records and reports.
- Priority: Must
- Acceptance criteria: The owner can create an item under a category, enable it for one or more usage areas, and later select the same active item in every enabled workflow but not in disabled usage areas. From each enabled transaction workflow, Quick Add saves the item to the catalog and returns with it selected.
- Source: Interview turns 21, 28, 46, 250–252, and 266
- Status: Confirmed

### FR-070
- Statement: “The system shall display live Receipt and Delivery Authorization blueprints while the owner enters or edits load data.”
- Rationale: The owner wants to see both expected printed/PDF transaction documents before confirmation.
- Actors: Owner.
- Trigger: The owner opens receipt creation or correction.
- Preconditions: The receipt form is available.
- Main behavior: Update both blueprints as shared load values change and expose separate Receipt and Delivery Authorization preview tabs. On phones, keep the form full width and expose a persistent Preview button or tab; closing the preview shall preserve all entered values. Permit the owner to view the configured English/Arabic and 58/80 mm variants, omit blank optional fields, and allow form and preview to appear side by side on larger screens. Render each document using its confirmed width-specific template and document-specific field split.
- Alternate and exception behavior: Before confirmation, mark both previews DRAFT PREVIEW, show em dashes for missing required values, omit blank optional fields, and place validation messages in the entry form rather than the document. Disable print, PDF, and share for draft previews.
- Postconditions: Before confirmation, the owner can compare entered data with both expected document appearances.
- Priority: Must
- Acceptance criteria: Changing shared load data updates the corresponding content in both preview tabs without confirming the transaction. Each tab contains only fields allowed by its confirmed document layout, and switching tabs or closing Preview loses no entered data. An incomplete entry is unmistakably marked DRAFT PREVIEW, uses placeholders only for missing required fields, omits blank optional fields, and offers no print, PDF, or sharing action.
- Source: Interview turns 252–262
- Status: Confirmed

### FR-020
- Statement: “The system shall record each incoming quarry-truck purchase.”
- Rationale: The owner needs to see how much material is purchased and whether it has been paid.
- Actors: Authorized purchasing or receiving staff; exact roles remain to be confirmed.
- Trigger: A truck delivers a purchased item from a quarry.
- Preconditions: A saved quarry/supplier profile and item can be selected or a new supplier can be created quickly; the supplier ticket/invoice provides the delivered quantity.
- Main behavior: Select a saved quarry/supplier or create one quickly, manually copy the positive whole cubic-metre quantity from the supplier ticket/invoice without requiring empty/full weighbridge entries, and record item, driver, plate number, automatic confirmation date/time, optional supplier ticket/invoice number, up to 20 optional ticket/invoice photos, and payment information without processing the payment. Automatically compress photos at readable quality. Optionally accept USD price per cubic metre, calculate purchase subtotal as quantity multiplied by that unit price, apply universal VAT, and calculate final purchase total. Make the delivery and attachments available offline and in synchronized supplier history.
- Alternate and exception behavior: Price is optional; a quantity-only delivery may be confirmed without financial tracking or VAT. A confirmed priced purchase retains its applied VAT rate and supports separate partial payments, balances, statuses, and final cancellation under the customer-order rules. A rejected delivery remains an unconfirmed draft and may be deleted to recoverable Trash; it affects no quantities, balances, inventory, or reports. Multiple trucks per purchase, corrections, and missing documents remain to be elicited.
- Postconditions: The delivery is available in quarry purchase and payment history; no inventory balance is changed.
- Priority: Must
- Acceptance criteria: The owner can confirm a quantity-only quarry delivery with a positive whole number of cubic metres and without price, VAT, supplier reference, photos, or payment balance; zero, negative, and decimal quantities are rejected. A priced purchase supports multiple order-linked payments, derived balance/status, and final payment cancellation. Confirmation records date/time; up to 20 readable-quality compressed attachments work offline/sync; the record appears in supplier history and never alters inventory.
- Source: Interview turns 21–22 and 26–30
- Status: Confirmed identity/quantity behavior; pricing and remaining fields pending

### FR-021
- Statement: “The system shall display a customer profile summary containing total quantity taken and total price.”
- Rationale: The owner needs an immediate overview of each customer's activity and value.
- Actors: Owner.
- Trigger: An authorized user opens a customer profile.
- Preconditions: The customer profile exists and has zero or more orders.
- Main behavior: Aggregate the customer's recorded order quantities separately by item and unit and present those separate totals; aggregate eligible USD prices under the confirmed blank/zero rules.
- Alternate and exception behavior: Never add quantities for different items or units into one total. Blank-price orders are excluded from financial totals. Cancelled-order behavior and date filtering remain to be defined.
- Postconditions: The user can see the customer's current aggregate summary.
- Priority: Must
- Acceptance criteria: A customer with 10 tons of asphalt and 8 cubic metres of concrete sees separate item/unit totals and no combined quantity of 18; corresponding receipts remain separate history entries.
- Source: Interview turn 23
- Status: Confirmed aggregation behavior; other inclusion rules pending

### FR-022
- Statement: “The system shall display every recorded order associated with a customer in that customer's history.”
- Rationale: The owner needs to review all customer orders and their payment state.
- Actors: Owner.
- Trigger: An authorized user opens customer history.
- Preconditions: The customer profile exists.
- Main behavior: List the customer's separate receipts/orders with item, quantity, unit, automatic financial status, amount paid, payment dates, and remaining balance where applicable. Status is Unpriced, No Payment Due, Unpaid, Partially Paid, Paid, or Overpaid according to the confirmed rules.
- Alternate and exception behavior: Partial/multiple payments, corrected or cancelled orders, and empty history remain to be defined.
- Postconditions: The user can trace customer totals and balances to individual orders.
- Priority: Must
- Acceptance criteria: Every included order for the customer is visible and shows its payment tracking information.
- Source: Interview turn 23
- Status: Draft

### FR-023
- Statement: “The system shall allow authorized users to record an in-person payment against a customer order.”
- Rationale: Payments occur outside the system but must be tracked.
- Actors: Owner.
- Trigger: The customer makes an in-person payment.
- Preconditions: The target customer order exists.
- Main behavior: Create a separate payment entry containing amount and date linked to the selected order, update that order's total paid and remaining balance, and show its payment status.
- Alternate and exception behavior: Multiple partial payments are allowed for the same order. If one real-world payment covers multiple orders, create separate entries for each order's allocated amount. Correction-created overpayment is handled elsewhere. A confirmed payment recorded by mistake can be marked Cancelled but not deleted. Cancellation requires an explicit warning and reason; the system records cancellation date/time. Cancelled entries and their cancellation details remain visible and do not affect totals or balances. Cancellation cannot be undone; create a new payment if needed.
- Postconditions: The customer profile and order history reflect the recorded payment.
- Priority: Must
- Acceptance criteria: Recording several partial payments against order 1 creates separate dated entries under order 1, does not attach them to order 2, and updates order 1's total paid and remaining balance without executing a financial transfer. A payment covering orders 1 and 2 requires one entry under each order. Cancelling opens a warning, requires a reason, records cancellation time, removes its amount from calculations, retains the entry/details visibly, and cannot be reactivated.
- Source: Interview turns 22–25
- Status: Confirmed

### FR-024
- Statement: “The system shall display the payment history for a selected customer order.”
- Rationale: Users need to see how much was paid and when for each specific order.
- Actors: Owner.
- Trigger: An authorized user views an order's payment details.
- Preconditions: The order exists.
- Main behavior: List every payment entry linked to that order with its amount, date, and Active or Cancelled state.
- Alternate and exception behavior: An order with no payments displays an empty payment history and its full unpaid balance.
- Postconditions: The user can reconcile the order's total paid and remaining balance with its payment entries.
- Priority: Must
- Acceptance criteria: The sum of non-cancelled listed payment amounts equals the order's displayed amount paid; each entry shows its date, and cancelled entries remain visible but are excluded from the sum.
- Source: Interview turn 25
- Status: Confirmed

### FR-025
- Statement: “The system shall allow authorized users to add configurable measurement units.”
- Rationale: User-defined items may require units beyond tons and cubic metres.
- Actors: Owner.
- Trigger: A required measurement unit is not available.
- Preconditions: The user has permission.
- Main behavior: Save a named measurement unit for selection in applicable item and transaction records.
- Alternate and exception behavior: Duplicate units, editing, deactivation, and historical impact remain to be defined.
- Postconditions: The unit is available for applicable configuration and records.
- Priority: Must
- Acceptance criteria: The owner can add a unit and subsequently select it in an applicable record or setting.
- Source: Interview turns 27–28 and 46
- Status: Confirmed behavior; lifecycle pending

### FR-026
- Statement: “The system shall maintain a current fuel-stock balance.”
- Rationale: The owner needs to record and see fuel stock.
- Actors: Owner.
- Trigger: Opening/current gauge litres are entered, delivered fuel litres are entered, fuel is issued to equipment, or stock is physically corrected.
- Preconditions: Fuel is tracked in litres.
- Main behavior: Establish the opening balance from the physical tank gauge; add recorded deliveries; subtract equipment fills; and replace the calculated balance with a later physical gauge reading when correcting/reconciling stock. Plant consumption is excluded from movement totals.
- Alternate and exception behavior: Unmeasured plant consumption creates differences resolved by physical gauge correction. Invalid readings and movement correction details remain to be defined.
- Postconditions: The displayed tracked balance reflects recorded deliveries and machine issues but may not equal physical stock.
- Priority: Must
- Acceptance criteria: An opening gauge reading of G sets balance to G; entering L delivered litres increases it by L; recording M litres issued to equipment decreases it by M; entering a later physical reading P replaces the calculated balance with P without rewriting earlier movements.
- Source: Interview turns 32 and 39–40
- Status: Confirmed

### FR-027
- Statement: “The system shall record each equipment fuel fill with its equipment, positive litre quantity, and confirmation date/time.”
- Rationale: Machine fuel consumption must be traceable.
- Actors: Authorized operational staff; exact role remains to be confirmed.
- Trigger: A machine is filled with fuel.
- Preconditions: A saved equipment profile can be selected or quickly created and the fuel amount is known.
- Main behavior: Select or quickly create equipment; require a positive litre quantity; assign the confirmation date/time automatically; optionally record project, reference-only odometer reading, and notes; reduce fuel balance by the recorded amount; and add the transaction to that equipment's fuel-consumption history.
- Alternate and exception behavior: Version one has no hour-meter field or automatic fuel-consumption-rate calculation. An optional odometer reading is retained only as reference and produces no fuel-economy calculation. A mistaken confirmed fill is cancelled with required reason and automatic time, remains visible, and restores its litres unless a later physical gauge baseline supersedes it. A fill exceeding calculated stock receives no warning or block; the manually entered litres are recorded and normally subtracted. Multiple fuel types remain to be defined.
- Postconditions: The equipment's fuel history contains the transaction and the fuel balance is updated; cancellation preserves the entry and applies the appropriate ledger reversal.
- Priority: Must
- Acceptance criteria: The owner can select or quickly create equipment; confirmation is blocked unless litres are positive; the saved fill shows equipment, litres, automatic confirmation time, and any optional supplied fields; it reduces fuel balance and appears in that equipment's consumption history. No hour-meter or derived fuel-consumption-rate field is displayed. A fill greater than calculated balance can be confirmed without an insufficient-stock warning.
- Source: Interview turns 32 and 182–186
- Status: Confirmed core fields; movement exceptions pending

### FR-063
- Statement: “The system shall record each fuel delivery added to the tank.”
- Rationale: Fuel deliveries must increase recorded stock and may carry supplier and purchasing references.
- Actors: Owner.
- Trigger: Fuel is delivered into the tracked tank.
- Preconditions: The delivered litre quantity is known.
- Main behavior: Require a positive litre quantity, assign the confirmation date/time automatically, increase the recorded fuel balance, and optionally retain a saved supplier, delivery ticket/invoice number, USD price per litre, and notes. When price is supplied, calculate subtotal as litres multiplied by unit price, apply the universal VAT rate and retain its snapshot, calculate final total, and track that delivery's supplier balance and separate payments using the established supplier-order rules.
- Alternate and exception behavior: A quantity-only delivery may omit supplier and price and has no VAT or payment balance. A priced delivery supports partial payments, automatic payment status, and final cancellation of mistaken payments under the established rules. A mistaken confirmed delivery is cancelled with required reason and automatic time, remains visible, and removes its litres unless a later physical gauge baseline supersedes it. Attachments remain to be defined.
- Postconditions: The confirmed delivery appears in fuel history and its litres increase the current calculated balance; a priced delivery also appears in supplier financial history with its own balance.
- Priority: Must
- Acceptance criteria: A delivery cannot be confirmed with zero or negative litres; a valid confirmed delivery increases balance by its litres, records its automatic confirmation time, and retains any supplied optional fields. For a priced delivery, subtotal equals litres × USD price/litre, universal VAT is applied using the confirmed snapshot, and payments affect only that delivery's balance. An unpriced delivery has no VAT or balance. Cancelling a delivery retains it as Cancelled with reason/time and reverses its ledger effect except where a later gauge baseline controls the current balance.
- Source: Interview turns 181 and 187–188
- Status: Confirmed fields and financial behavior; movement exceptions pending

### FR-064
- Statement: “The system shall allow the owner to export and restore a complete application backup.”
- Rationale: The owner requires an independent copy that can be stored on personally controlled hardware.
- Actors: Owner.
- Trigger: The owner selects Complete Backup or Restore Complete Backup.
- Preconditions: The owner is authenticated, supplies and confirms an owner-chosen backup password for export, and has sufficient device or storage-provider capacity available.
- Main behavior: Export one package containing all records, settings, profiles, transaction documents, payments, logs, signatures, photos, attachments, and restoration metadata, encrypted with the separate owner-chosen backup password; allow it to be saved through the phone to a computer, USB/external storage, or cloud-storage provider. Opening or restoring requires that password. Validate a selected compatible package, show its backup date and record counts, require explicit confirmation, automatically export a safety backup of current data, and then replace the current dataset without merging.
- Alternate and exception behavior: Insufficient storage, interrupted export/import, invalid or corrupted file, incompatible application version, and incorrect or forgotten backup password remain to be handled. An incomplete or invalid restore shall not partially change live data; if replacement succeeds but proves unwanted, the automatic safety export supports reversal. The package cannot be opened without its password.
- Postconditions: A successful export creates an independently retained complete backup; a successful restore reconstructs its validated application state.
- Priority: Must
- Acceptance criteria: Export a representative full dataset and transfer it off-device. On restore, verify the preview date/counts, confirmation, and current-data safety export occur before replacement; verify all restored records, settings, documents, payments, logs, signatures, photos, attachments, and relationships match the backup with no duplicates or merge; verify invalid/interrupted restore leaves current data unchanged.
- Source: Interview turns 210–211
- Status: Confirmed package, password encryption, and replacement safeguards; compatibility details pending

### FR-028
- Statement: “The system shall allow a project foreman to create one daily work report for each project workday.”
- Rationale: The foreman needs to document what occurred during work.
- Actors: Project foreman.
- Trigger: The owner opens Reports, selects the needed project, and chooses Make Report for a project workday.
- Preconditions: A saved project has been selected from the Reports project list and the owner is identifiable.
- Main behavior: From Reports, show projects for selection. Selecting a project opens its report area and existing report history with Make Report; that action creates the report already associated with the chosen project. Require work date and short description of work performed. Present sections for work description, workers, drivers, truck plates, machines, materials, notes, problems/delays/incidents, weather/site conditions, working time, and next work planned. Working time may contain start time, end time, and break duration; when supplied, calculate net working time as end minus start minus break. Allow manual presence entries and material entries containing item, quantity, unit, and used/transported classification; allow up to 20 optional photos from the phone camera or device library, automatically compressed at readable quality, that remain available offline and synchronize with the report; generate a shareable and printable PDF containing every section and all attached photos; and provide an Excel export with structured data in normal worksheets and embedded reduced-size photos in a separate Photos worksheet.
- Alternate and exception behavior: Workers, drivers, trucks, machines, materials, notes, problems/delays/incidents, weather/site conditions, working time, next work planned, and photos may remain empty. An empty working-time section produces no duration; when entered, end cannot precede start and break cannot exceed the start/end interval. The report remains editable after saving and does not require approval or locking. It retains creation and latest-update date/time only, with no detailed edit history or prior versions. Today and past work dates are allowed; future dates are rejected. If the selected project/date already has a report, open it for editing instead of creating a duplicate. Completed projects expose history/export but no Make Report action until reactivated.
- Postconditions: The editable report is retained in project history.
- Priority: Must
- Acceptance criteria: Reports shows saved projects; selecting one opens that project's report history and Make Report action; the new report is pre-associated with that project. It cannot be saved without a non-future work date and non-empty work description. Every report displays all confirmed sections and may be saved when every optional section is empty. A time interval 07:00–17:00 with a 01:00 break yields 09:00 net; an end before start or break over 10 hours is rejected. Any supplied material entry identifies item, quantity, unit, and used/transported classification. Optional camera/library photos remain accessible with the report offline and after synchronization. Its generated PDF is printable/shareable and contains every section and all attached photos. Its Excel export contains structured worksheets and a separate Photos worksheet with embedded reduced-size copies of all attachments. A second creation attempt for the same project/date opens the existing report rather than saving a duplicate.
- Source: Interview turns 32–38 and 194–202
- Status: Confirmed

### FR-029
- Statement: “The system shall allow an authorized user to manually correct the recorded fuel balance after checking the physical tank.”
- Rationale: Plant fuel consumption is not measurable through the system, so calculated stock can differ from actual stock.
- Actors: Owner.
- Trigger: A physical tank check shows a different amount from the recorded balance.
- Preconditions: The actual tank quantity in litres is known.
- Main behavior: Require a non-negative actual gauge-litre reading and a reason; automatically retain the previous calculated balance, signed difference added or removed, and correction date/time; optionally retain notes; and replace the current calculated fuel balance with the entered actual litre amount as the new baseline.
- Alternate and exception behavior: Zero is valid and negative litres are rejected. A mistaken correction is cancelled with required reason and automatic time and remains visible. If it is the latest valid baseline, restore its stored previous balance and apply subsequent active movements; if a newer valid correction exists, it continues to govern current balance.
- Postconditions: The recorded balance equals the entered physical-tank amount, subsequent movements use it as the current baseline, and earlier fuel movements remain unchanged.
- Priority: Must
- Acceptance criteria: Confirmation requires actual litres of zero or more and a reason; it stores the previous balance, signed difference, automatic date/time, and optional notes; the current balance becomes the entered actual reading without altering prior delivery or equipment-fill records. Cancellation retains the correction with reason/time and produces the baseline-aware recalculation described above.
- Source: Interview turns 40–41 and 189
- Status: Confirmed

### FR-030
- Statement: “The system shall provide a prominent ‘Make Receipt’ action on the home screen.”
- Rationale: Creating a receipt is the owner's highest-priority home-screen task.
- Actors: Owner.
- Trigger: An authorized user selects “Make Receipt.”
- Preconditions: The user has receipt permission.
- Main behavior: Open the receipt-creation workflow.
- Alternate and exception behavior: Unsaved work and missing prerequisite settings remain to be defined.
- Postconditions: The user can begin entering the receipt/load information.
- Priority: Must
- Acceptance criteria: An authorized user can begin receipt creation directly from the home screen with one selection of the visible action.
- Source: Interview turn 44
- Status: Confirmed

### FR-031
- Statement: “The system shall provide selectable home-dashboard summaries.”
- Rationale: Users want access to all relevant summaries but control over what is visible.
- Actors: Owner.
- Trigger: A user opens or configures the home dashboard.
- Preconditions: Summary data and dashboard access are available.
- Main behavior: Offer summaries with fixed default scopes: Today's Loads for today; Unpaid Orders for all currently Unpaid or Partially Paid orders; Fuel Balance as current calculated balance; Quarry Purchases as current-month totals; and Missing Daily Reports for today. Allow visible summaries to be chosen and make every widget open its corresponding detailed report with the widget's current filters applied, where other periods can be selected. Count a missing daily report only when an active project has at least one confirmed load for that date and no report for the same project/date; remove it when the report is created.
- Alternate and exception behavior: Empty data, unavailable widgets, and default selection remain to be defined.
- Postconditions: The dashboard displays the selected summaries.
- Priority: Must
- Acceptance criteria: Each known summary can be shown or hidden while Make Receipt remains prominent; selecting a visible widget opens the correct detailed report and reproduces the widget's active filter scope. A confirmed load for active Project A today with no report adds one missing-report warning; creating that report removes it; an active Project B with no load adds none.
- Source: Interview turns 44–45, 236, and 241–242
- Status: Confirmed

### FR-032
- Statement: “The system shall support a Draft → Review → Confirm → Print receipt workflow independent of printer availability.”
- Rationale: A printer may be disconnected or printing may fail, but the business record must not be lost.
- Actors: Owner.
- Trigger: The owner creates a draft, reviews it, and selects Confirm.
- Preconditions: Required receipt data is valid.
- Main behavior: Save receipt data as a draft, present it for review, explicitly confirm it, then enable printing.
- Alternate and exception behavior: Printer unavailable or print failure leaves the receipt saved and available on the current screen for another print attempt.
- Postconditions: The confirmed receipt is non-deletable and printable; persistence does not depend on print success.
- Priority: Must
- Acceptance criteria: A draft cannot print; after review and explicit Confirm, the receipt can print and cannot be deleted; unavailable printer does not prevent confirmation.
- Source: Interview turns 53 and 76–77
- Status: Confirmed; validation/draft behavior pending

### FR-033
- Statement: “The system shall allow a receipt to be printed repeatedly without a fixed copy limit, both while open and after reopening it from history.”
- Rationale: The owner may need multiple physical copies.
- Actors: Owner.
- Trigger: The owner selects print while viewing a newly created or historically reopened receipt.
- Preconditions: A compatible printer is available.
- Main behavior: Send another copy to the selected printer without changing the original transaction identity or confirmation date/time. Mark the output as a copy, print the current copy date/time, and create a lightweight reprint-event log entry containing document identity, reprint date/time, and device.
- Alternate and exception behavior: Print failure does not change the saved receipt. Show Retry and Reconnect printer. Until the app reports one successful original print, retry attempts remain original outputs; only successful later attempts use COPY behavior and create reprint-log entries.
- Postconditions: Another physical copy is produced when printing succeeds, visibly distinguishable from the original output, and its event is retained in the reprint log without duplicating document contents.
- Priority: Must
- Acceptance criteria: The owner can print multiple copies, leave the receipt screen, reopen the saved receipt from history, and print it again. A failed original followed by Retry remains unmarked until the first app-reported successful print. Each successful later reprint retains the original confirmation date/time, is marked as a copy, shows its reprint date/time, and creates a log entry identifying the document, time, and device. Failed attempts create no reprint entry, copy number, or duplicate document record.
- Source: Interview turns 53–54 and 204
- Status: Confirmed

### FR-034
- Statement: “The system shall support core application workflows without an internet connection.”
- Rationale: The owner works where internet may be unavailable.
- Actors: Owner.
- Trigger: The device has no internet connection.
- Preconditions: The app is installed and accessible.
- Main behavior: Allow creation/editing of in-scope records, receipt creation/saving, Bluetooth printing, daily-report creation/editing, capture/reopening of attachments, and PDF/Excel report generation/local saving using local data.
- Alternate and exception behavior: Functions requiring unavailable remote data, synchronization, and storage exhaustion remain to be defined.
- Postconditions: Offline changes are retained locally without data loss.
- Priority: Must
- Acceptance criteria: With network disabled, the owner can create and reopen a receipt, print over Bluetooth, create/edit a daily report, generate and save representative PDF/Excel reports, and retain changes after restarting the app.
- Source: Interview turns 56 and 232
- Status: Confirmed for core workflows; synchronization pending

### FR-035
- Statement: “The system shall automatically synchronize locally retained offline changes when internet connectivity returns.”
- Rationale: The owner needs offline continuity and the same data on another phone.
- Actors: System; owner.
- Trigger: Connectivity becomes available while unsynchronized changes exist.
- Preconditions: The device can authenticate to the synchronization service.
- Main behavior: Upload local changes and all associated settings, profiles, documents, payments, logs, signatures, photos, attachments, and restoration metadata, and make the complete synchronized dataset available to the owner's other device and cloud recovery service.
- Alternate and exception behavior: On failure, retain local changes, show them as pending, and retry automatically. If the same record changed on two offline devices, keep the newest edit. The owner may then manually correct that resulting record.
- Postconditions: The complete successfully synchronized dataset is durable in cloud storage and available on other signed-in owner devices.
- Priority: Must
- Acceptance criteria: Create records with settings, documents, payments, logs, signatures, photos, and attachments offline, restore connectivity, and verify the complete dataset synchronizes and appears on another signed-in device. Create conflicting edits on two devices, verify the newest edit is retained, then manually correct the resulting record and verify the correction synchronizes.
- Source: Interview turns 57, 67, and 214
- Status: Confirmed

### FR-036
- Statement: “The system shall restore all synchronized owner data after the owner installs the app and signs in on a replacement device.”
- Rationale: The owner must recover from a lost, damaged, or replaced phone.
- Actors: Owner.
- Trigger: The owner signs in on a newly installed or replacement device.
- Preconditions: Authentication succeeds and synchronized data exists.
- Main behavior: Download and reconstruct the owner's synchronized records and settings.
- Alternate and exception behavior: No connectivity, failed authentication, incomplete restore, storage limits, and point-in-time recovery remain to be defined.
- Postconditions: The replacement device contains the synchronized data.
- Priority: Must
- Acceptance criteria: Synchronize a known dataset from device A, install on device B, sign in, and verify that all synchronized records and settings are restored.
- Source: Interview turn 58
- Status: Confirmed behavior; recovery error handling pending

### FR-037
- Statement: “The system shall authenticate the owner using an email address and password.”
- Rationale: Synchronized business data and replacement-device recovery require owner authentication.
- Actors: Owner.
- Trigger: The owner signs in on a device.
- Preconditions: An owner account exists.
- Main behavior: Verify the supplied email address and password and grant access on success.
- Alternate and exception behavior: Invalid credentials are rejected. Forgotten password uses a secure email reset link. After successful initial sign-in, the session remains available offline without an account-password prompt on each app opening. Lockout and remote revocation remain to be defined.
- Postconditions: The authenticated owner can access application data and synchronization.
- Priority: Must
- Acceptance criteria: Valid credentials grant access; invalid credentials do not; requesting password recovery sends a secure reset link to the owner account email.
- Source: Interview turns 59–61
- Status: Confirmed method and recovery channel; detailed security controls pending

### FR-038
- Statement: “The system shall allow the owner to reset a forgotten password through a secure link sent to the registered email address.”
- Rationale: The sole user needs self-service account recovery.
- Actors: Owner.
- Trigger: The owner requests password recovery.
- Preconditions: The submitted email corresponds to the owner account.
- Main behavior: Send a time-limited reset link and allow a new password to be set.
- Alternate and exception behavior: Unknown email, expired/used link, delivery failure, and repeated requests require secure handling.
- Postconditions: A successful reset invalidates the prior password, signs out all other device sessions, and permits sign-in with the new password.
- Priority: Must
- Acceptance criteria: The registered email receives a usable reset link; an expired or used link cannot reset the password; after successful reset, previously signed-in devices require the new credentials once they receive the revocation.
- Source: Interview turns 60 and 64
- Status: Confirmed behavior; link lifetime and offline revocation timing pending

### FR-039
- Statement: “The system shall export reports in PDF and Excel formats.”
- Rationale: The owner needs fixed-layout documents and structured data for further analysis.
- Actors: Owner.
- Trigger: The owner selects an export format while viewing a report.
- Preconditions: The report and its data have been generated.
- Main behavior: Within the Reports screen, present Active Projects, Completed Projects, and Business Reports. Active projects open history and Make Report; completed projects open history/export only until reactivated. Business Reports provides five groups—Loads and Sales, Customer Balances and Payments, Quarry Purchases and Supplier Balances, Fuel Movements and Current Balance, and Projects and Daily Work Reports. Allow applicable filtering by date range, category/item, customer/project, and payment status, then produce a PDF or Excel file representing the filtered report. Every export shows company header/report title, generation date/time, all active filters, and totals for each numeric section. PDF repeats column headings and shows page numbers; Excel freezes header rows and provides filterable columns. Output uses the selected English-LTR or Arabic-RTL layout.
- Alternate and exception behavior: Generate and locally save files from on-device data while offline. Internet is needed only for synchronization or an online share destination. For large exports, show records generated and provide Cancel. Cancellation, failure, or application closure removes incomplete output and creates no partial file; the owner may restart later. Empty results, sharing, and report printing remain to be defined.
- Postconditions: The generated file is available locally on the phone regardless of internet connectivity.
- Priority: Must
- Acceptance criteria: With network disabled, each of the five groups can be viewed and locally exported in PDF and Excel from on-device data. Applying supported filters changes the displayed/exported dataset consistently; PDF and Excel contain the same records/totals within the selected scope and all shared presentation elements. Multi-page PDF headings repeat with correct page numbers; Excel opens with frozen header rows and per-column filters; both languages use the correct direction. Cancelling or closing a large export after progress begins leaves no incomplete file, and restarting can complete normally.
- Source: Interview turns 65–66 and 225–233
- Status: Confirmed content, presentation, offline generation, and large-export interruption behavior

### FR-065
- Statement: “The system shall provide a Loads and Sales report combining operational and financial load information.”
- Rationale: The owner needs one filtered view for load review, sales totals, payment follow-up, and signature follow-up.
- Actors: Owner.
- Trigger: The owner opens or exports Loads and Sales.
- Preconditions: Zero or more load records exist.
- Main behavior: List transaction number/date-time, customer/project, item, driver/plate, net weight, billed quantity/unit, unit price, subtotal, VAT, final total, paid amount, remaining or overpaid amount, payment status, and Signed/Unsigned status for each matching load.
- Alternate and exception behavior: Unpriced and No Payment Due loads use their established financial statuses; optional project and overpaid values display only when applicable. Empty result and export failures follow common report behavior.
- Postconditions: The viewed and exported report represents the active filter scope.
- Priority: Must
- Acceptance criteria: For the same active filters, screen, PDF, and Excel contain the same matching loads and all listed columns, with correct separate quantity units and derived financial/signature states.
- Source: Interview turns 225–226
- Status: Confirmed columns; layout pending

### FR-066
- Statement: “The system shall provide Customer Summary and Payment Details reports.”
- Rationale: The owner needs both customer-level balance follow-up and transaction-level payment reconciliation.
- Actors: Owner.
- Trigger: The owner opens or exports Customer Balances and Payments.
- Preconditions: Zero or more customer/order/payment records exist.
- Main behavior: Customer Summary lists customer name, total billed, total paid, remaining or overpaid balance, unpaid-order count, and latest payment date. Payment Details lists payment date, amount, linked transaction number, order total, balance after payment, and Cancelled status/reason when applicable. Excel uses separate Summary and Payment Details worksheets.
- Alternate and exception behavior: Customers with Unpriced or No Payment Due orders follow established inclusion rules; customers with no payments show no latest-payment date; cancelled payments remain visible but excluded from paid totals. Empty results follow common report behavior.
- Postconditions: Both views and their exports reflect the active filter scope and established balance rules.
- Priority: Must
- Acceptance criteria: Summary totals reconcile with active non-cancelled linked payments and eligible order totals; the detail sheet traces each included payment to exactly one transaction and shows cancellation data without counting cancelled amounts.
- Source: Interview turns 225 and 227
- Status: Confirmed

### FR-067
- Statement: “The system shall provide Supplier Summary, Quarry Purchase Details, and Supplier Payment Details reports.”
- Rationale: The owner needs supplier-level quantity/financial totals and traceable purchase/payment events.
- Actors: Owner.
- Trigger: The owner opens or exports Quarry Purchases and Supplier Balances.
- Preconditions: Zero or more supplier, quarry-purchase, or supplier-payment records exist.
- Main behavior: Supplier Summary lists supplier, total quantity separately by item, total billed, total paid, remaining or overpaid balance, latest delivery, and latest payment. Purchase Details lists date, supplier, ticket/invoice number, item, whole m³ quantity, driver, plate, price per m³, subtotal, VAT, final total, paid, remaining, status, and photo count. Payment Details lists payment date, amount, linked purchase, balance after payment, and cancellation details. Excel uses three corresponding worksheets.
- Alternate and exception behavior: Quantity-only purchases contribute to quantity totals but not financial balances; cancelled payments remain visible but excluded from paid totals; missing optional ticket, price, or photos appears blank under established rules.
- Postconditions: All three views and exports reflect active filters and reconcile under supplier-purchase payment rules.
- Priority: Must
- Acceptance criteria: Supplier item quantities equal included purchase quantities without combining different items; financial totals exclude unpriced purchases and cancelled payments; each payment traces to exactly one purchase; PDF/Excel contain the confirmed sections and columns.
- Source: Interview turns 225 and 228
- Status: Confirmed

### FR-068
- Statement: “The system shall provide Fuel Balance Summary, Movement Details, and Equipment Totals reports.”
- Rationale: The owner needs current stock visibility, an auditable movement ledger, and simple per-equipment litre totals.
- Actors: Owner.
- Trigger: The owner opens or exports Fuel Movements and Current Balance.
- Preconditions: The one version-one fuel tank/type has zero or more baselines or movements.
- Main behavior: Balance Summary shows current calculated litres, latest physical gauge reading/date, and selected-period totals delivered, filled into equipment, and correction difference. Movement Details shows date/time, movement type, supplier or equipment, project, ticket number, litres added or removed, balance after movement, applicable price/VAT/payment status, and Cancelled status/reason. Equipment Totals shows equipment name and total litres filled during the selected period. Excel uses three corresponding worksheets.
- Alternate and exception behavior: Quantity-only deliveries omit financial columns; cancelled movements remain visible and ledger balances follow the baseline-aware cancellation rules; equipment with no period fills may be omitted. No hour-meter or consumption-rate value is calculated.
- Postconditions: The report reflects the active filters and reconciles with the current baseline-governed fuel ledger.
- Priority: Must
- Acceptance criteria: Current balance and period movement totals reconcile under active/cancelled movement and physical-baseline rules; equipment totals equal included active fills; PDF/Excel contain the three confirmed sections with no hour-meter calculation.
- Source: Interview turns 225 and 229
- Status: Confirmed

### FR-069
- Statement: “The system shall provide Project Summary, Daily Report Index, and Materials Summary reports.”
- Rationale: The owner needs project oversight, quick daily-report discovery, and structured material totals.
- Actors: Owner.
- Trigger: The owner opens or exports Projects and Daily Work Reports.
- Preconditions: Zero or more projects, loads, or daily reports exist.
- Main behavior: Project Summary lists project, customer, location, status, start/end dates, load quantities separately by item/unit, daily-report count, and latest work date. Daily Report Index lists work date, description, workers, drivers, trucks, machines, problems/delays/incidents, photo count, created date, last-updated date, and a link to the full report. Materials Summary lists project, item, unit, total used, and total transported. Excel uses three corresponding worksheets; each full daily report retains its detailed PDF and Excel exports.
- Alternate and exception behavior: Optional dates, presence entries, issues, and photos display blank or zero as appropriate. Different item/unit quantities are never combined. Links unavailable outside the app shall still preserve a report identifier sufficient to locate the record.
- Postconditions: The reports reflect active filters and link summary/index entries to their full project or daily records.
- Priority: Must
- Acceptance criteria: Project quantities remain separate by item/unit; report counts and latest dates reconcile with included daily reports; used and transported totals reconcile with material entries; the index opens the correct full report; PDF/Excel contain the three confirmed sections.
- Source: Interview turns 225 and 230
- Status: Confirmed

### FR-040
- Statement: “The system shall filter reports using the applicable date range, category/item, customer/project, and paid/unpaid criteria selected by the owner.”
- Rationale: The owner needs to isolate relevant operational and financial records.
- Actors: Owner.
- Trigger: The owner changes report filters.
- Preconditions: The report supports the selected filter dimension.
- Main behavior: Recalculate the report using records matching all selected criteria.
- Alternate and exception behavior: Empty results and filter combinations not applicable to a report shall be handled clearly.
- Postconditions: The displayed report and subsequent exports use the active filter scope.
- Priority: Must
- Acceptance criteria: Records outside any selected criterion are excluded, and clearing filters restores the unfiltered report.
- Source: Interview turn 66
- Status: Confirmed

### FR-041
- Statement: “The system shall allow the owner to directly correct a saved or issued receipt.”
- Rationale: Receipt data may need correction after issuance without a cancel-and-replace workflow.
- Actors: Owner.
- Trigger: The owner identifies incorrect receipt information.
- Preconditions: The receipt exists and is accessible.
- Main behavior: Allow permitted receipt fields to be edited and save the corrected receipt under the same receipt identity.
- Alternate and exception behavior: Prior receipt values are overwritten and no receipt-change history is retained. Existing payment records are never rewritten by a receipt correction. If recalculation makes recorded payments exceed the corrected total, display the difference as an overpaid amount; the system does not process a refund.
- Postconditions: Receipt history and reprints show corrected values; net/converted quantity, total price, remaining balance or overpaid amount, and customer summary are recalculated.
- Priority: Must
- Acceptance criteria: Correcting weight or price updates the receipt, recalculates all dependent values and customer totals, and causes later prints to show corrected values only. If a fully paid $1,000 order is corrected to $800, the original $1,000 payment remains and the app displays an overpaid amount of $200.
- Source: Interview turns 70–72 and 91–92
- Status: Confirmed, including correction-created overpayments

### FR-042
- Statement: “The system shall move eligible deleted records to a recoverable trash area rather than permanently deleting them immediately.”
- Rationale: The owner needs to recover records deleted by mistake.
- Actors: Owner.
- Trigger: The owner deletes a record that is permitted to be deleted.
- Preconditions: The record exists and is not already in trash.
- Main behavior: Mark the eligible record deleted, remove it from normal views/totals as applicable, and make it available in trash.
- Alternate and exception behavior: Only intentionally deleted business-record drafts are eligible for trash. Confirmed business records cannot be deleted, and configuration options use deactivation rather than deletion. Trash records remain until the owner manually permanently deletes them.
- Postconditions: The record is recoverable from trash and excluded from active workflows.
- Priority: Must
- Acceptance criteria: An intentionally deleted business-record draft moves to trash and can be restored. It remains restorable beyond 30 days and disappears permanently only after the owner manually deletes it from trash. Confirmed business-record deletion is rejected, and configuration options cannot enter trash.
- Additional source: Interview turn 94
- Source: Interview turns 75–76 and 79
- Status: Confirmed

### FR-043
- Statement: “The system shall prevent deletion of a confirmed receipt.”
- Rationale: Completed business records must remain available in history.
- Actors: Owner.
- Trigger: The owner attempts to delete a confirmed receipt.
- Preconditions: The receipt has confirmed status.
- Main behavior: Reject deletion and retain the receipt.
- Alternate and exception behavior: Direct correction remains allowed; drafts may be edited or deleted before confirmation.
- Postconditions: The confirmed receipt remains available in history.
- Priority: Must
- Acceptance criteria: A confirmed receipt has no successful deletion path and remains retrievable after a deletion attempt.
- Source: Interview turn 76
- Status: Confirmed

### FR-044
- Statement: “The system shall require explicit owner confirmation after review before enabling receipt printing.”
- Rationale: The owner needs to verify data before producing a non-deletable printable receipt.
- Actors: Owner.
- Trigger: The owner selects Confirm from the receipt review.
- Preconditions: The receipt is a draft and meets confirmation validation rules.
- Main behavior: Change status to Confirmed and enable print actions.
- Alternate and exception behavior: Invalid/missing data blocks confirmation; undoing confirmation remains undefined.
- Postconditions: The receipt is confirmed, printable, and non-deletable.
- Priority: Must
- Acceptance criteria: Print is unavailable for a draft and becomes available only after explicit confirmation.
- Source: Interview turn 77
- Status: Confirmed; validation rules pending

### FR-046
- Statement: “The system shall require every business record to be explicitly confirmed before it becomes final.”
- Rationale: The owner requires review and confirmation across all tracked information.
- Actors: Owner.
- Trigger: The owner finishes entering and reviewing a record.
- Preconditions: The record is a draft and all required fields and validation rules pass.
- Main behavior: Provide an explicit confirmation action that changes the record from draft to final/confirmed.
- Alternate and exception behavior: If required data is missing or invalid, block confirmation and highlight what must be fixed. Confirmed records cannot be deleted but may be corrected. Settings save directly.
- Postconditions: The business record is confirmed, non-deletable, correctable, and included in final histories, totals, and reports.
- Priority: Must
- Acceptance criteria: A draft missing a required field cannot be confirmed and identifies that field; after required data is corrected, confirmation succeeds. Confirmed records are non-deletable/correctable; settings save without confirmation.
- Source: Interview turns 81–85
- Status: Confirmed; record-specific rules pending

### FR-048
- Statement: “The system shall clearly identify every missing or invalid field that prevents business-record confirmation.”
- Rationale: The owner must be able to correct a draft efficiently.
- Actors: Owner.
- Trigger: The owner attempts to review or confirm an invalid draft.
- Preconditions: One or more required fields or validation rules fail.
- Main behavior: Block confirmation and show clear field-level messages for each issue.
- Alternate and exception behavior: Multiple simultaneous errors shall all remain discoverable.
- Postconditions: The record remains draft until the issues are corrected.
- Priority: Must
- Acceptance criteria: A receipt missing customer, plate, or required weights cannot confirm, and each missing value is visibly identified. Negative empty or full weights and negative prices are rejected. A full weight less than or equal to the empty weight blocks confirmation and visibly identifies the invalid weight relationship. Blank, intentional $0.00, and positive prices remain valid. Missing driver signature does not block confirmation.
- Source: Interview turns 85–86 and 126
- Status: Confirmed for required fields, weight validation, and price sign; other record-specific rules pending

### FR-049
- Statement: “The system shall validate each recorded order payment against the order's current remaining balance.”
- Rationale: Payment tracking must not produce an invalid negative balance or require a customer-credit model.
- Actors: Owner.
- Trigger: The owner enters or confirms a payment linked to an order.
- Preconditions: The linked order has a calculated remaining balance.
- Main behavior: Accept a payment only when its amount is greater than zero and no greater than the current remaining balance.
- Alternate and exception behavior: Block zero, negative, and excessive payment amounts and identify the valid remaining balance.
- Postconditions: The order's remaining balance stays between zero and its total price.
- Priority: Must
- Acceptance criteria: For an order with a remaining balance of $1,000, payments of $0, a negative amount, or more than $1,000 are rejected; a positive payment up to $1,000 is accepted.
- Source: Interview turns 88–90
- Status: Confirmed; correction-created overpayments are handled by FR-041 and BR-024

### FR-050
- Statement: “The system shall automatically save business-record drafts during data entry.”
- Rationale: In-progress work must not be lost when the app closes, the phone loses power, or the workflow is interrupted.
- Actors: Owner.
- Trigger: The owner creates or changes data in a business-record draft.
- Preconditions: A draft business record is open.
- Main behavior: Persist draft changes automatically without requiring an explicit save action.
- Alternate and exception behavior: If synchronization is unavailable, retain the autosaved draft locally and synchronize it later under the existing offline rules.
- Postconditions: Reopening the app or draft restores the latest successfully autosaved data.
- Priority: Must
- Acceptance criteria: Enter data in a draft, close the app without confirming, reopen it, and verify that the latest autosaved draft data is restored.
- Source: Interview turn 93
- Status: Confirmed; exact autosave timing pending

### FR-051
- Statement: “The system shall require explicit confirmation before permanently deleting a record from trash.”
- Rationale: Permanent deletion is irreversible and requires protection from accidental activation.
- Actors: Owner.
- Trigger: The owner chooses to permanently delete a trash record.
- Preconditions: The record is eligible for permanent deletion and is currently in trash.
- Main behavior: Display a clear irreversible-deletion warning and require a separate confirmation action.
- Alternate and exception behavior: Cancelling the warning leaves the record unchanged and recoverable in trash.
- Postconditions: Only a confirmed permanent-deletion action removes the record irreversibly.
- Priority: Must
- Acceptance criteria: Selecting permanent deletion opens a warning; cancelling preserves the record; confirming removes it from trash and prevents restoration through the app.
- Source: Interview turn 95
- Status: Confirmed

### FR-052
- Statement: “The system shall allow configuration options to be deactivated without changing historical records.”
- Rationale: Obsolete categories, items, units, or conversions should not clutter new-entry choices, while historical documents must remain accurate.
- Actors: Owner.
- Trigger: The owner deactivates or reactivates a configuration option.
- Preconditions: The configuration option exists.
- Main behavior: Hide a deactivated option from new-record selections while retaining it for historical display; allow later reactivation.
- Alternate and exception behavior: Deactivation must not recalculate, relabel, or otherwise change an existing receipt or record. Every confirmed receipt retains its own permanent copy of the conversion values used.
- Postconditions: New workflows show only active options, and historical records remain unchanged.
- Priority: Must
- Acceptance criteria: After deactivating a conversion used by old receipts, it cannot be selected on a new receipt, remains correctly displayed on old receipts, and becomes selectable again if reactivated.
- Source: Interview turns 98–99
- Status: Confirmed, including historical conversion fields

### FR-047
- Statement: “The system shall save configuration settings without a Draft → Review → Confirm lifecycle.”
- Rationale: Requiring confirmation for categories, items, units, and conversions adds unnecessary steps.
- Actors: Owner.
- Trigger: The owner saves a valid configuration setting.
- Preconditions: Required configuration values are present and valid.
- Main behavior: Save the category, item, unit, or conversion directly.
- Alternate and exception behavior: Editing, deletion, dependencies, duplicates, and historical impact remain to be defined.
- Postconditions: The configuration becomes available to applicable workflows.
- Priority: Must
- Acceptance criteria: The owner can save a valid category, item, unit, or conversion without a separate confirmation step.
- Source: Interview turn 83
- Status: Confirmed

### FR-045
- Statement: “The system shall allow both a confirmed delivery authorization and a confirmed receipt to be generated as PDF documents.”
- Rationale: The owner needs portable digital copies of both transaction documents in addition to POS printing.
- Actors: Owner.
- Trigger: The owner selects PDF while viewing a confirmed delivery authorization or receipt.
- Preconditions: The applicable transaction document is confirmed.
- Main behavior: Generate a PDF containing the current corrected document values and allow the owner to send or share either document using phone capabilities.
- Alternate and exception behavior: File-generation or sharing failure, offline generation, and layout by paper/document size remain to be defined.
- Postconditions: The PDF is available on the phone and can be sent through an available phone sharing destination.
- Priority: Must
- Acceptance criteria: A confirmed delivery authorization and confirmed receipt/invoice bill can each be printed, generate a readable PDF containing the same current values as their print views, and open the phone's sharing options. No third invoice document is generated.
- Additional source: Interview turn 102
- Source: Interview turn 78
- Status: Confirmed; layout pending

## 10. Business Rules

### BR-001
- An outside-customer truck is weighed empty before loading and weighed again after loading. (Source: Turn 6; status: Confirmed.)

### BR-002
- The requested quantity is retained only as an informational comparison value. Actual net quantity from the weighbridge controls the receipt and billing. No variance threshold or warning applies. (Sources: Turns 6 and 131–134; status: Confirmed.)

### BR-031
- A requested-versus-actual quantity difference shall not prevent confirmation. Billing uses actual measured quantity, and the app shall not apply a variance threshold or warning. (Sources: Turns 131–134; status: Confirmed.)

### BR-032
- At confirmation, a transaction number consisting of local date, device code, and device-local sequence and the original confirmation date/time are assigned. Both are shared by the document pair, immutable, and never reused or changed by correction/reprint. (Sources: Turns 137–138; status: Confirmed.)

### BR-033
- Every reprint shall retain the original confirmation date/time, be visibly marked as a copy, and show the reprint date/time. It shall create a log entry containing document identity, reprint date/time, and device, without a copy number or duplicate document contents. (Sources: Turns 138–140; status: Confirmed.)

### BR-034
- Receipt final total equals its calculated subtotal plus VAT calculated from the universal tax-setting percentage. VAT applies to numeric prices; zero produces zero VAT; Unpriced has no VAT. A confirmed receipt permanently retains its applied rate. USD VAT and totals use the established nearest-cent rule. (Sources: Turns 158–159; status: Confirmed.)

### BR-003
- Each completed load, whether for the owner's company or an outside customer, requires both a delivery authorization and a receipt/invoice bill. (Sources: Turns 7, 10â€“11, and 104; status: Confirmed.)

### BR-004
- Each item has its own variable default price per output unit. Only the owner may change it in version one. Editing a price within a receipt affects only that transaction; editing an item's price in the dedicated settings section changes its default for future receipts until changed again. A priced receipt total equals converted quantity multiplied by its selected price per output unit. (Sources: Turns 8–9, 46, 109, and 112–113; status: Confirmed.)

### BR-005
- No asphalt work is exempt from recording solely because it is for the owner's own project rather than an outside project/customer. (Source: Turn 10; status: Confirmed.)

### BR-006
- The owner's company shall be treated as the customer for loads serving its own projects, and those loads shall follow the same operational and document workflow as outside-customer loads. (Source: Turn 11; status: Confirmed.)

### BR-007
- The price field may be empty or intentionally $0.00 on any receipt, whether for the owner's company or an outside customer. Blank means Unpriced, has no payment balance, and is excluded from financial totals. Intentional $0.00 is included as a zero-value order with no payment due. (Sources: Turns 12 and 124–125; status: Confirmed.)

### BR-008
- Net kilograms equal full kilograms minus empty kilograms. (Source: Turn 13; status: Confirmed.)

### BR-009
- Asphalt conversion shall use 1,000 kg = 1 ton and display three decimal places, preserving each entered whole kilogram exactly. Other conversions shall use the selected configured rate and output unit; their applicability, precision, and rounding remain to be confirmed. (Sources: Turns 13–14 and 118; status: Partially confirmed.)

### BR-010
- Asphalt and concrete shall use the same basic empty-weigh, load, full-weigh, calculate, record, and document workflow. (Source: Turn 15; status: Confirmed.)

### BR-011
- Staff shall select the load material manually. While preparing the receipt, the user shall separately select an appropriate saved conversion-rate option. (Sources: Turns 18–19; status: Confirmed as corrected.)

### BR-012
- Categories and items are business-configurable and shall not be hard-coded to asphalt and concrete. (Source: Turn 21; status: Confirmed.)

### BR-013
- Payments occur in person outside the system. The system only records and tracks payment information. (Source: Turn 22; status: Confirmed.)

### BR-014
- Customer profiles shall aggregate quantities separately by item and unit and expose each separate receipt/order's automatic financial status and remaining balance. Unlike quantities shall never be combined. Blank-price orders are Unpriced; intentional $0.00 orders are No Payment Due; positive orders progress through Unpaid, Partially Paid, or Paid; correction-created excess is Overpaid. (Sources: Turns 23, 125, 128, and 166; status: Confirmed.)

### BR-035
- Order status shall be derived as follows: blank price = Unpriced; $0.00 total = No Payment Due; positive total with zero paid = Unpaid; paid amount between zero and total = Partially Paid; paid amount equal to total = Paid; paid amount above a corrected total = Overpaid. (Source: Turn 166; status: Confirmed.)

### BR-036
- A confirmed payment cannot be deleted but may be marked Cancelled after an explicit warning and required reason. The system records the cancellation date/time; the entry, reason, and time remain visible and contribute zero to paid totals, remaining balances, and status derivation. Cancellation is final and cannot be reactivated. (Sources: Turns 167–169; status: Confirmed.)

### BR-015
- An order may receive multiple partial payments. Each payment entry is linked to exactly one order, and remaining balance equals order total less the sum of its linked payment amounts. A real-world payment covering several orders is recorded as separate entries per order. (Sources: Turns 24–25 and 165; status: Confirmed.)

### BR-016
- A quarry delivery records its quantity directly and does not require the empty/full weighbridge workflow used for outgoing loads. (Source: Turn 26; status: Confirmed.)

### BR-017
- Quarry delivery quantity is manually copied from the supplier ticket/invoice as a positive whole number of cubic metres; decimal quantities are invalid. Measurement units elsewhere remain configurable. (Sources: Turns 27 and 177–178; status: Confirmed.)

### BR-018
- Quarry delivery records are for quantity and payment tracking only and shall not modify an inventory or stock balance. (Source: Turn 30; status: Confirmed.)

### BR-019
- Tracked fuel balance starts from the latest physical tank-gauge baseline, adds recorded deliveries, and subtracts recorded equipment fills. Plant fuel consumption is excluded, so the calculated result may differ until the next physical correction. (Sources: Turns 32, 39–41, and 181; status: Confirmed with limitation.)

### BR-020
- Daily project reports remain editable after saving and require no approval or locking in the current workflow. They retain creation and latest-update date/time only, with no detailed change log or prior versions. (Sources: Turns 38 and 202; status: Confirmed.)

### BR-021
- A manual physical-tank correction resets the current fuel-balance baseline but shall not rewrite prior fuel delivery or equipment-fill records. It retains the previous balance, signed difference, automatic date/time, required reason, and optional notes. (Sources: Turns 41 and 189; status: Confirmed.)

### BR-037
- Version one shall contain no hour-meter field and no automatic litres-per-hour calculation. (Sources: Turns 184 and 186; status: Confirmed as corrected in Turn 186.)

### BR-038
- Odometer readings recorded on equipment fills are reference-only and shall not produce a litres-per-distance calculation. (Source: Turn 185; status: Confirmed.)

### BR-039
- A cancelled fuel delivery or equipment fill remains in history with its cancellation reason and time. The original movement's stock effect is reversed only within the calculation segment governed by its baseline; a later physical gauge correction continues to control subsequent balance and is not changed by cancelling an earlier movement. (Source: Turn 190; status: Confirmed.)

### BR-040
- Cancelling the latest valid physical gauge correction restores its stored previous calculated balance and applies all subsequent active fuel movements. Cancelling a correction superseded by a newer valid gauge baseline does not alter current balance. The cancelled correction remains in history with its required reason and automatic cancellation time. (Source: Turn 191; status: Confirmed.)

### BR-041
- The calculated fuel balance shall not validate or restrict a manually entered equipment-fill quantity. A positive fill is recorded and subtracted even when it exceeds the calculated balance. (Source: Turn 192; status: Confirmed.)

### BR-042
- All version-one fuel baselines and movements belong to one shared tank and one fuel type. Separate tank or fuel-type identities are not recorded. (Source: Turn 193; status: Confirmed.)

### BR-043
- A daily project report work date cannot be in the future, and the project/work-date pair is unique. Selecting an existing pair opens its editable report. (Source: Turn 203; status: Confirmed.)

### BR-022
- Empty and full weight values shall be non-negative whole kilograms, and the full weight must be greater than the empty weight before a receipt can be confirmed. (Sources: Turns 86 and 116; status: Confirmed.)

### BR-023
- A payment linked to an order must be greater than zero and cannot exceed that order's current remaining balance. (Source: Turn 90; status: Confirmed.)

### BR-024
- Receipt or order corrections shall not alter existing payment records. When recorded payments exceed a corrected order total, the difference shall be shown as an overpaid amount. (Source: Turn 92; status: Confirmed.)

### BR-025
- Synchronized confirmed business records shall not expire or be deleted automatically; they shall remain permanently available. (Source: Turn 97; status: Confirmed.)

### BR-026
- All version-one prices, payments, balances, receipts, and financial reports shall use USD. Mixed-currency orders and currency conversion are out of scope. (Source: Turn 114; status: Confirmed.)

### BR-027
- All USD prices, totals, payments, balances, and financial-report amounts shall display two decimal places and round to the nearest cent. (Source: Turn 120; status: Confirmed.)

### BR-028
- Receipt prices shall be blank, zero, or positive; negative prices are invalid and block confirmation. (Source: Turn 126; status: Confirmed.)

### BR-029
- Receipt total equals the converted quantity rounded to its configured displayed precision multiplied by the receipt's price per output unit; the resulting USD total is then rounded to the nearest cent. (Source: Turn 127; status: Confirmed.)

### BR-030
- Each delivery-authorization and receipt pair represents exactly one truck load and one item. Multiple loads or items require separate document pairs and separate customer-history entries. (Source: Turn 129; status: Confirmed.)

## 11. Data Requirements

### DR-001
- The system shall store in-scope asphalt-plant management records digitally. The entities, attributes, ownership, validation, lifecycle, retention, classification, and migration needs remain to be elicited. (Source: Turn 2; status: Draft.)

### DR-002
- The conceptual data model shall include one underlying business record representing each one-to-one production batch and truck load, exposed through unified Load History, plus paving days, trucks, drivers, and fuel records. Remaining attributes and relationships require clarification. (Sources: Turns 3, 149, 151, and 155; status: Draft.)

### DR-003
- Each customer profile shall retain a required type of Individual or Company and a required name/company name. Phone number, email, address, Tax/VAT number, and notes are optional. Every receipt references exactly one saved profile, which associates the customer with its load/order histories and quantities; quick creation is available during receipt entry. New-profile duplicate detection compares name, phone, and Tax/VAT number and warns without blocking. An optionally merged duplicate retains archived status and a merged-into reference, while associations move to the retained profile and issued document contents remain unchanged. (Sources: Turns 4, 157, and 160–163; status: Confirmed.)

### DR-004
- Each truck load shall retain the desired weight, manually entered empty whole kilograms, manually entered full whole kilograms, calculated net whole kilograms, converted quantity, customer, applicable project, truck plate, exactly one production-batch association, signature state, payment status, transaction number, and confirmation date/time. Asphalt converted tons display three decimal places. Other timestamps, vehicle attributes, and correction behavior are covered elsewhere or remain to be elicited. (Sources: Turns 6, 10–11, 13, 116, 118, 149, and 156; status: Partially confirmed.)

### DR-005
- A delivery authorization shall include the immutable shared transaction number in date-device-sequence format, original confirmation date/time, permanently snapshotted company header with configured contact details directly beneath the company name, customer, applicable project or destination, item, driver name, plate number, optional requested quantity, empty weight, full weight, net weight, calculated converted quantity with its output unit, destination address, and optional finger-drawn driver signature. A blank requested quantity is omitted. No selected conversion name, conversion rate/formula, unit price, subtotal, VAT, payment, balance, or final total appears. Every print/PDF includes the current signature drawing when present; a reprint additionally shows a copy mark and reprint date/time. History shows Signed or Unsigned, and an unsigned confirmed transaction may receive a signature later. Clearing or replacement retains no prior drawing or change log. (Sources: Turns 7, 134, 136–146, 217–218, 220–221, and 256–257; status: Confirmed field split as corrected.)

### DR-006
- A receipt shall include the same immutable date-device-sequence transaction number and original confirmation date/time as its delivery authorization, permanently snapshotted company header, customer name, project name when selected, final/net weight, unit price, subtotal, applied universal VAT percentage, VAT amount, and final total. A null price is labeled Unpriced and has no VAT calculation; intentional USD 0.00 represents no payment due and produces zero VAT. Project is omitted when none is selected. Driver, plate, requested quantity, empty/full weights, conversion details, destination, signature, payment status, paid amount, remaining balance, and overpaid amount are omitted. A reprint additionally shows a copy mark and reprint date/time. (Sources: Turns 7–8, 12, 109, 114, 120, 124–125, 136–138, 158–159, 217–218, and 220–221; status: Confirmed field split.)

### DR-007
- Each load record shall retain one required customer association and an optional project association. The project association is required when the customer is the owner's company and optional for outside customers. An outside load without a project retains a destination address. (Sources: Turns 10 and 147–148; status: Confirmed.)

### DR-008
- Customer records shall support the owner's company as a customer so its own-project loads appear in customer history. (Source: Turn 11; status: Confirmed conceptually.)

### DR-009
- A saved conversion option shall retain its name, rate, input unit, output unit, displayed decimal places, active state, and selection identity. Conversion options are not associated with or filtered by item; every active option is available for manual receipt selection. (Sources: Turns 14, 19, 99, 119, and 123; status: Confirmed.)

### DR-010
- Each load shall retain a material classification of asphalt or concrete. Future extensibility and any material subtype or mix association remain to be defined. (Source: Turn 15; status: Draft.)

### DR-011
- The conceptual model shall include categories and items, with each item associated with a category and retaining its own saved default price per output unit. Names, identifiers, status, validation, currency, and other item-specific attributes remain to be defined. (Sources: Turns 21 and 113; status: Draft.)

### DR-012
- A quarry purchase record shall reference one saved quarry/supplier profile and include item, required positive whole cubic-metre quantity manually copied from the supplier ticket/invoice, driver, vehicle plate number, truck-level identity, and automatic confirmation date/time. Supplier delivery-ticket/invoice number and up to 20 readable-quality compressed paper-document photos are optional. Optional pricing retains USD price per cubic metre, calculated subtotal, applied universal VAT-rate snapshot, VAT amount, final total, derived paid amount, remaining balance, and status, and relates to zero or more separate payment entries under the customer-order payment/cancellation rules. An unpriced purchase has no balance. Attachments remain available offline, synchronize, and restore with the record. The supplier profile requires name and may retain phone, email, address, Tax/VAT number, and notes. Other attributes remain to be elicited. (Sources: Turns 21, 26–29, 170–179, and 200; status: Partially confirmed.)

### DR-013
- A customer order shall retain its customer, exactly one truck load and item reference, quantity, unit, USD price state, derived total paid, remaining balance, and automatically derived status of Unpriced, No Payment Due, Unpaid, Partially Paid, Paid, or Overpaid, with every USD value displayed to two decimal places. Different items or loads use separate receipt/order history entries. An order relates to zero or more separate USD payment entries. (Sources: Turns 23–25, 114, 120, 128–129, and 166; status: Partially confirmed; other attributes pending.)

### DR-014
- Each payment entry shall retain its USD amount to two decimal places, payment date, association with exactly one customer order, and Active or Cancelled state. A real-world payment covering multiple orders is represented by separate entries for their respective allocated amounts. A cancelled entry retains required reason and automatic cancellation date/time, remains in history, is excluded from calculations, and cannot be reactivated. Other fields remain open. (Sources: Turns 25, 120, 165, and 167–169; status: Partially confirmed.)

### DR-015
- A measurement unit shall retain a name or symbol and identifier. Associations, validation, lifecycle, and historical behavior remain to be defined. (Source: Turn 27; status: Draft.)

### DR-016
- The conceptual model shall include one shared version-one fuel tank/type with opening/physical-gauge baselines, deliveries, equipment fills, physical corrections, and saved equipment profiles. Separate tank or fuel-type identities are not recorded. Equipment requires a name and may include type, plate/serial/internal code, and notes. A gauge reading contains required non-negative actual litres and reason, automatic previous calculated balance, signed difference and date/time, and optional notes; it establishes the current baseline. A fuel delivery contains positive litres added and automatic confirmation date/time, and may reference a saved supplier and contain delivery ticket/invoice number, USD price per litre, and notes. A priced delivery also retains subtotal, universal VAT-rate snapshot, VAT amount, final total, paid amount, remaining balance, status, and separate payment records; an unpriced delivery has none of those financial balances. An equipment fill references one saved equipment profile, contains positive litres subtracted and an automatic confirmation date/time, and may contain project, reference-only odometer reading, and notes. Each confirmed delivery, fill, or gauge correction may retain Cancelled status, required cancellation reason, and automatic cancellation time; cancelled entries remain visible and ledger recalculation respects later valid gauge baselines. Each equipment profile exposes its fill history. Version one has no hour-meter or derived fuel-consumption-rate field, and calculated stock does not validate or block fill quantities. (Sources: Turns 32, 39–41, and 181–193; status: Confirmed for version-one model.)

### DR-017
- A project daily work report shall be uniquely associated with one required saved project and one required non-future work date and retain its foreman/author, required short activity description, creation date/time, and latest-update date/time. It shall contain always-present, optionally empty sections for manual worker names, driver names, truck plates, machine names, material entries, notes, problems/delays/incidents, weather/site conditions, working time, next work planned, and up to 20 photo attachments. Working time may retain start time, end time, and break duration. Each supplied material entry contains item, quantity, unit, and used/transported classification. Photos may come from the phone camera or library, are automatically compressed at readable quality, and remain available offline and synchronized. The report remains editable without approval or locking and retains no detailed edit log or prior versions; selecting an existing project/date opens it for editing. Its PDF includes every section and all photos, and its Excel export contains structured worksheets plus a separate Photos worksheet with embedded reduced-size copies. (Sources: Turns 32–38, 194–203, and 244; status: Confirmed.)

### DR-018
- Each confirmed receipt shall store the conversion name, input unit, output unit, conversion rate, displayed decimal places, source weight or quantity, and calculated converted quantity used at confirmation. These stored values shall remain unchanged by later configuration edits, deactivation, or reactivation. (Sources: Turns 99–101 and 119; status: Confirmed.)

### DR-019
- Each reprint event shall retain the transaction/document identity, reprint date/time, and device identity. It shall not retain a duplicate snapshot of the document contents or a copy sequence number. (Source: Turn 140; status: Confirmed.)

### DR-020
- Each project shall retain a required name, associated customer/company, location or destination address, and Active or Completed status. Start date, end date, and notes are optional. (Source: Turn 148; status: Confirmed.)

### DR-021
- Tax settings shall retain one universal VAT percentage. Each confirmed numeric-priced receipt or quarry purchase shall retain its own applied VAT-rate snapshot, calculated VAT amount, subtotal, and final total. (Sources: Turns 158–159 and 174; status: Confirmed.)

### DR-022
- Company/Profile Settings shall retain one required company name and optional logo, address, phone, email, Tax/VAT registration number, and receipt footer message. Applicable configured contact details, including address and phone number, appear directly beneath the company name on transaction documents. At confirmation, each transaction's document pair permanently snapshots the configured values then in use. Later settings edits affect only new transactions; old PDFs and reprints retain their snapshot. (Sources: Turns 217–218 and 257; status: Confirmed.)

### DR-023
- An item shall retain required name, one required category association, Active/Inactive status defaulting Active, and at least one enabled usage flag for Loads, Quarry Purchases, or Daily Reports. Internal code, description/notes, default unit, and a default receipt price when Loads is enabled are optional. Categories are organizing groups rather than transaction records. The same item identity may be referenced by multiple enabled workflows; receipt conversion remains separate. Each confirmed referencing record snapshots the item name, optional code, category, and unit used at confirmation, which later catalog edits cannot change. An item referenced by any record cannot be deleted, but may be deactivated and later reactivated; only never-used items may move to restorable Trash. A supplied internal code is unique; similar names produce a non-blocking warning showing the possible match. (Sources: Turns 250–252 and 266–268; status: Confirmed.)

## 12. External Interface and Integration Requirements

### IR-001
- The application shall print both transaction documents through the existing Xprinter Android POS terminal's built-in 58 mm printer and from Android and iPhone to compatible separate portable Bluetooth printers using 58 mm and 80 mm layouts. A printer model is officially supported only after successful physical testing with the app; compatibility with untested Bluetooth models is not guaranteed. Version-one acceptance requires successful printing of both documents through the existing terminal and through separate 58 mm and 80 mm Bluetooth printers from both phone platforms. The existing terminal may be model XP-POS-I100; exact models and protocols remain to be validated. (Sources: Turns 47–52 and 107–108; status: Confirmed scope, integration path, and test matrix; exact technical details draft.)

### IR-002
- Receipt formatting shall adapt to a user-selected 58 mm or 80 mm POS paper layout rather than assuming one fixed width. Other widths are deferred and may be added later. (Sources: Turns 49–51 and 106; status: Confirmed.)

### IR-003
- Printer unavailability or failure shall not change a confirmed transaction or prevent its persistence. The application shall show Retry and Reconnect printer. Attempts remain the original print until the app reports one successful output; only successful later prints are marked COPY and create reprint-log entries. (Sources: Turns 53–54 and 204; status: Confirmed.)

### IR-004
- The application shall generate reports in PDF/Excel-compatible formats and both confirmed transaction documents as PDF files that can be stored or shared using phone capabilities. The owner can send the delivery authorization PDF to the customer, and every delivery-authorization print/PDF includes the stored digital driver signature. The receipt does not display the signature. (Sources: Turns 65, 78, 102–104, and 141–143; status: Confirmed for document sharing/signature placement; report layouts pending.)

## 13. Non-Functional Requirements

### NFR-001 — Portability
- The version-one user experience shall support both Android phones and iPhones. Screen-size baseline, minimum OS versions, and verification devices remain to be confirmed. (Sources: Turns 47–48; status: Confirmed at platform level.)

### NFR-002 — Availability and Offline Operation
- Core workflows shall remain available without internet and offline changes shall synchronize automatically after connectivity returns. Verification: execute FR-034 offline on Android and iPhone, restore connectivity, and verify FR-035 cross-device visibility. (Sources: Turns 56–57; status: Partially confirmed; recovery/conflict details pending.)

### NFR-003 — Backup and Recovery
- The complete synchronized dataset—including current confirmed records, settings, profiles, documents, payments, logs, signatures, photos, attachments, and restoration metadata—shall remain available permanently with no automatic expiration and shall be recoverable on a replacement device. The server shall also retain complete daily point-in-time snapshots for a rolling 30-day recovery window; expiry of an old snapshot does not delete current live data. The owner shall self-restore an available snapshot by selecting its date, previewing record counts, automatically creating a safety backup, and explicitly confirming full replacement. Eligible deleted drafts remain in trash until manually permanently deleted after confirmation. The owner can independently export and restore an encrypted complete-backup package. Verification: restore the full dataset to a replacement device, self-restore an eligible complete server snapshot within 30 days, validate expiry of older snapshots without loss of live data, and round-trip a complete manual backup. (Sources: Turns 58, 75, 79, 94–95, 97, and 210–214; status: Confirmed data coverage and restore workflow; cloud destination and recovery timing pending.)

### NFR-005 — Reliability
- A failed synchronization attempt shall not lose locally saved records. Pending changes shall remain identifiable and retry automatically. Same-record conflicts shall retain the newest edit. Verification: inject failures and conflicting timestamps, then verify durability, pending indication, retry, and newest-edit result. (Sources: Turns 67–69; status: Confirmed.)

### NFR-004 — Security
- Initial access shall require email/password authentication. After initial sign-in, access remains available offline without repeated prompts. App-specific biometric/PIN locking is excluded. A successful password reset shall revoke all other device sessions once they can receive the revocation. Complete manual backups shall be encrypted with a separate owner-chosen password required to open or restore them. Password storage, transport protection, reset security, revocation timing, backup-password strength/forgetting behavior, and brute-force controls require measurable definition. (Sources: Turns 59–64 and 213; status: Draft.)

### NFR-006 — Receipt Confirmation Performance
- On a supported ordinary phone operating offline, tapping Confirm on a valid receipt shall durably save the transaction, complete its calculations, and make both transaction documents ready for printing within 2 seconds. Bluetooth transmission and physical printer time are excluded. Verification: test representative valid receipts offline on each supported verification device and measure from Confirm input until the saved transaction and both print-ready documents are available. (Sources: Turns 205–206; status: Confirmed target; exact verification devices pending.)

### NFR-007 — History Capacity and Response Time
- On supported ordinary phones, history searches and filters shall return within 2 seconds with at least 10 years of retained data at the confirmed peak of approximately 20 loads per day, represented by a verification dataset of at least 73,000 loads and their associated records. Verification shall include common customer, project, date, item, plate, signature, and payment-status filters. (Sources: Turns 207–209; status: Confirmed target; exact verification devices pending.)

### NFR-008 — Localization and Bidirectional Layout
- All version-one application screens and generated documents shall support English using left-to-right layout and Arabic using right-to-left layout. The app provides an interface-language switch. Each print/PDF selects one language at output time and lays out only that language; the same saved transaction may be output later in the other language without data change. User-entered Arabic, English, or mixed names, addresses, descriptions, and notes are preserved exactly, rendered with appropriate bidirectional behavior, and never automatically translated; only interface/document labels are localized. Both layouts use Western digits 0–9 for dates, identifiers, weights, quantities, prices, VAT, and all other numeric values. Text alignment, field order, navigation direction, punctuation, tables, signature placement, PDFs, and 58 mm/80 mm print layouts shall remain readable in the applicable direction. Verification shall exercise every core workflow and both document layouts in each language, mixed-script business values, Western-digit numeric fields, and language switching without transaction mutation. (Sources: Turns 222–224; status: Confirmed.)

## 14. Roles and Permissions

- Plant owner/manager: Requires access to plant-wide information and reports and is the only role permitted to change the default price per ton. Other permissions remain to be elicited. (Sources: Turns 2 and 9; status: Partially confirmed.)
- Manager/foreman: The owner currently uses the same account/role context to create and edit daily project reports; no separate approval role is required. (Source: Turn 38; status: Confirmed for current operation.)
- Version-one access model: One owner account has all application capabilities. No staff accounts or role-based permissions are included. (Source: Turn 46; status: Confirmed.)
- Future access model: Staff accounts and permissions are deferred.

## 15. Constraints

### CON-001
- The system shall not process payments; it shall only record and track information about payments completed in person. (Source: Turn 22; status: Confirmed.)

### CON-002
- Quarry delivery tracking shall not implement inventory balance updates. (Source: Turn 30; status: Confirmed.)

### CON-003
- Plant fuel consumption cannot be measured and shall not be included in recorded fuel-consumption totals. (Source: Turn 40; status: Confirmed.)

### CON-004
- The first version shall have a single application user: the owner. Staff accounts are out of scope for version one. (Sources: Turns 45–46; status: Confirmed.)

### CON-005
- Version one is phone-first and depends on compatibility with the selected Bluetooth POS printer environment. (Source: Turn 47; status: Confirmed at platform level.)

### CON-007
- Version one supports exactly one fuel tank and one fuel type. Multiple tanks and fuel types are deferred to a future upgrade. (Source: Turn 193; status: Confirmed.)

## 16. Acceptance and Success Criteria

- The owner confirmed that the scope summarized through Turn 42 accurately reflects the intended product direction. Measurable operational success criteria remain to be elicited.
- Receipt creation must be directly accessible from the home screen. (Source: Turn 44.)
- The owner confirmed the single-user Android/iPhone, durable receipt history, and repeated Bluetooth-printing scope through Turn 55.
- The owner confirmed the consolidated Draft → Review → Confirm lifecycle, confirmed-record correction/non-deletion, manual trash retention, and receipt weight-validation scope through Turn 87.
- A familiar user shall normally be able to enter, review, confirm, and reach Print for a representative receipt within two minutes. This is a usability benchmark only; exceeding it never times out, closes, confirms, or cancels a transaction, and draft autosave continues. (Sources: Turns 247–248.)
- A 100-load verification dataset shall produce correct net weights, displayed conversions, VAT, totals, balances, and unique transaction numbers. (Sources: Turns 246–248.)
- The app shall complete one full operating day offline, survive device/app restart, and later synchronize without lost or duplicated records. (Sources: Turns 246–248.)
- Both transaction documents shall pass the confirmed physical printer test matrix for officially supported built-in/separate 58 mm and 80 mm Android/iPhone paths. (Sources: Turns 107–108 and 246–248.)
- Complete cloud data and an encrypted manual backup shall each restore on a replacement phone with matching records, settings, photos, signatures, documents, and relationships. (Sources: Turns 210–214 and 246–248.)
- Core screens, PDFs, and printer layouts shall pass in English LTR and Arabic RTL with Western digits 0–9. (Sources: Turns 222–224 and 246–248.)
- Operational acceptance requires 30 consecutive operating days using the app as the primary business record system, with all loads/documents, quarry deliveries, fuel movements, payments, and required daily reports recorded; no confirmed data lost; and dashboard/report totals reconciled. Paper is limited to required printed outputs and external supplier paperwork. (Sources: Turns 246–248.)

## 17. Risks

### RISK-001
- The stated scope of seeing and reporting “everything” is not yet bounded and could lead to uncontrolled scope growth or missed expectations. (Source: Turn 2; status: Open.)

### RISK-002
- Existing records are incomplete because some batches have not been recorded; historical migration and resulting statistics may therefore be incomplete or unreliable. (Source: Turn 3; status: Open.)

### RISK-003
- Manual transcription of weighbridge readings can introduce errors that propagate into net weight, price, documents, history, and reports. Validation and correction controls remain to be defined. (Source: Turn 13; status: Open.)

### RISK-004
- A concrete conversion from kilograms to cubic metres could be inaccurate unless the applicable density or mix-specific conversion factor is correctly configured. (Source: Turn 14; status: Open.)

### RISK-005
- Freely configurable categories/items and an unbounded expectation of “all details” could result in inconsistent records unless required fields and workflow behavior are defined. (Source: Turn 21; status: Open.)

### RISK-006
- The tracked fuel balance may overstate actual stock because plant consumption is not recorded. Manual physical-tank correction is the confirmed mitigation; the frequency and audit history remain open. (Sources: Turns 40–41; status: Mitigated in part.)

### RISK-007
- Cross-platform Bluetooth printing cannot be treated as universally compatible across all POS printers and sizes. Official support is limited to models successfully tested with the app. Release testing covers the built-in Xprinter terminal plus separate 58 mm and 80 mm printers from Android and iPhone; exact models and protocols remain open. (Sources: Turns 49 and 107–108; status: Mitigated in part.)

### RISK-008
- Persistent offline access may expose business/customer data if a signed-in phone is lost. Password-reset session revocation is required, but a lost phone that remains offline may retain access until it reconnects; app-specific local locking is excluded. (Sources: Turns 61–64; status: Partially mitigated.)

### RISK-009
- Newest-edit-wins conflict handling may silently discard an older offline edit. This is accepted for simplicity in the single-user release. (Source: Turn 69; status: Accepted.)

### RISK-010
- Direct receipt correction without prior-value history reduces auditability and prevents reconciliation with copies printed before correction. The owner accepts this for simplicity. (Source: Turn 71; status: Accepted.)

### RISK-011
- A stored driver signature may be cleared or replaced without retaining the prior drawing or a signature-change log, reducing signature auditability. The owner accepts this for simplicity. (Sources: Turns 145–146; status: Accepted.)

## 18. Requirements Traceability

| Requirement | Source turn(s) | Stakeholder goal | Acceptance criteria status |
|---|---|---|---|
| FR-001 | 2 | Replace paper-based management information with digital records | Pending scope detail |
| FR-002 | 2 | Give the owner reports of plant information | Pending report detail |
| DR-001 | 2 | Make plant records digitally available | Pending data detail |
| FR-003 | 3 | Establish reliable batch history | Pending batch detail |
| FR-004 | 3 | Track truck/driver participation by paving day | Partially defined |
| FR-005 | 3 | Replace paper-only fuel records | Pending fuel detail |
| DR-002 | 3 | Represent the initially identified operational records | Pending relationships and attributes |
| FR-006 | 4 | Record asphalt quantities supplied to external customers | Partially defined |
| FR-007 | 4 | Preserve customer supply history | Partially defined |
| DR-003 | 4 | Represent individuals, companies, and their transactions | Pending data detail |
| FR-008 | 6 | Preserve the two weighbridge measurements for each customer collection | Partially defined |
| FR-009 | 6 | Record the customer's requested load target | Partially defined |
| BR-001 | 6 | Require pre-load and post-load weighing | Defined; exceptions pending |
| BR-002 | 6 | Load toward the customer's desired weight | Tolerance pending |
| DR-004 | 6 | Represent collection weights and associations | Pending attributes and validation |
| FR-010 | 7 | Produce the detailed delivery authorization | Field list partly defined |
| FR-011 | 7 | Produce the load receipt | Price calculation and fields pending |
| BR-003 | 7 | Require two documents per completed customer load | Defined; exception handling pending |
| DR-005 | 7 | Capture delivery-authorization data | Additional fields and formats pending |
| DR-006 | 7 | Capture receipt data | Commercial fields pending |
| FR-012 | 8–9 | Support manager-controlled persistent per-ton pricing | Core acceptance criteria defined; audit pending |
| BR-004 | 8–9 | Apply the manager's current default price | Defined; transaction override remains open |
| FR-013 | 10 | Preserve complete histories for own and outside work | Category rules pending |
| BR-005 | 10 | Ensure own-project work is not omitted | Defined at scope level |
| DR-007 | 10 | Distinguish and associate own and outside work | Project attributes pending |
| BR-006 | 11 | Apply one workflow to own and outside work | Internal payment treatment pending |
| DR-008 | 11 | Preserve the owner's own load history through a customer record | Defined conceptually |
| BR-007 | 12 | Allow an unpriced receipt for own-project work | Reporting semantics pending |
| FR-014 | 13 | Derive net asphalt weight from weighbridge readings | Defined |
| FR-015 | 13–14 | Convert net kilograms using a selected rule and output unit | Permissions, applicability, and rounding pending |
| BR-008 | 13 | Apply full-minus-empty formula | Defined |
| BR-009 | 13–14 | Use 1,000 kg/ton for asphalt and selected rules otherwise | Further configuration pending |
| DR-009 | 14 | Represent selectable conversion rules | Versioning and applicability pending |
| FR-016 | 15 | Distinguish asphalt and concrete loads | Selection behavior pending |
| BR-010 | 15 | Keep one simple workflow for both materials | Document terminology pending |
| DR-010 | 15 | Retain each load's material type | Mix association pending |
| BR-011 | 18–19 | Manually select material and separately select a saved conversion for the receipt | Defined; compatibility rules pending |
| FR-017 | 19–20 | Add and change reusable conversion-rate options | Core permission defined; data fields pending |
| FR-018 | 21 | Add named business categories | Permissions and lifecycle pending |
| FR-019 | 21 | Add named items within categories | Item behavior pending |
| FR-020 | 21 | Track incoming quarry purchases and payment status | Workflow and fields pending |
| BR-012 | 21 | Avoid hard-coded asphalt/concrete scope | Defined |
| DR-011 | 21 | Represent configurable categories and items | Attributes pending |
| DR-012 | 21 | Represent quarry purchase deliveries and payment | Detailed model pending |
| BR-013 | 22 | Separate payment tracking from payment execution | Defined |
| CON-001 | 22 | Exclude in-app payment processing | Defined |
| FR-021 | 23 | Summarize customer quantities and total price | Unit and inclusion rules pending |
| FR-022 | 23 | Show complete customer order/payment history | Exception handling pending |
| FR-023 | 22–23 | Track in-person payments against orders | Allocation rules pending |
| BR-014 | 23 | Derive customer summary and order balances | Aggregation rules pending |
| DR-013 | 23 | Represent customer order payment tracking | Payment cardinality pending |
| BR-015 | 24 | Support partial order payment and remaining balance | Multiple-payment history pending |
| FR-024 | 25 | Show separate dated payments for each order | Defined |
| DR-014 | 25 | Represent order-linked payment entries | Additional fields pending |
| BR-016 | 26 | Use direct quantity entry for quarry deliveries | Unit/source pending |
| FR-025 | 27 | Add configurable measurement units | Permissions and lifecycle pending |
| BR-017 | 27 | Record quarry quantity in cubic metres | Source pending |
| DR-015 | 27 | Represent configurable units | Attributes and associations pending |
| FR-018 | 21, 28 | Manage named categories | Lifecycle pending |
| FR-019 | 21, 28 | Manage items within categories | Item behavior pending |
| FR-025 | 27–28 | Manage measurement units | Lifecycle pending |
| DR-012 | 21, 26–29 | Represent quarry truck deliveries | Inventory effect and remaining metadata pending |
| BR-018 | 30 | Keep quarry tracking separate from inventory | Defined |
| CON-002 | 30 | Exclude quarry inventory updates | Defined |
| FR-027 | 32 | Track machine refuelling and amount | Detailed fields pending |
| FR-028 | 32–37 | Create a structured daily project report | Activity fields and approval pending |
| BR-019 | 32 | Reduce recorded fuel stock for machine issues | Stock model pending |
| DR-016 | 32 | Represent fuel movements and machines | Attributes pending |
| DR-017 | 32 | Represent project work reports | Fields and lifecycle pending |
| BR-020 | 38 | Keep daily reports editable without approval | Audit history pending |
| FR-026 | 32, 39–40 | Calculate delivered-minus-machine fuel balance | Labeling/correction pending |
| CON-003 | 40 | Exclude unmeasurable plant fuel consumption | Defined |
| RISK-006 | 40 | Avoid treating machine-only balance as exact physical stock | Mitigation pending |
| FR-029 | 40–41 | Reconcile recorded fuel to a physical tank check | Audit fields pending |
| BR-021 | 41 | Preserve transaction history when correcting current balance | Derived; audit detail pending |
| FR-030 | 44 | Make receipt creation the primary home action | Defined |
| FR-031 | 44 | Let users select visible dashboard summaries | Preference scope pending |
| CON-004 | 45–46 | Limit version one to the owner as sole user | Defined |
| DEC-038 | 46 | Defer staff accounts until after version one | Defined |
| IR-001 | 47 | Print receipts through a Bluetooth POS printer | Device/protocol details pending |
| NFR-001 | 47–48 | Support both Android and iPhone | Minimum versions/devices pending |
| CON-005 | 47 | Use a phone-first Bluetooth-printing environment | Compatibility details pending |
| IR-002 | 49 | Adapt receipt layout to supported paper widths | Width list pending |
| RISK-007 | 49 | Bound Android/iPhone POS-printer compatibility | Model/protocol pending |
| DEC-043 | 52 | Support existing Xprinter and portable Bluetooth printers | Integration validation pending |
| FR-032 | 53 | Save receipts independently of printing | Defined |
| FR-033 | 53–54 | Allow unlimited current and historical receipt printing | Defined |
| DEC-045 | 54 | Reopen and reprint saved receipts from history | Defined |
| FR-034 | 56 | Operate core workflows without internet | Synchronization pending |
| NFR-002 | 56–57 | Verify offline operation and automatic synchronization | Conflict handling pending |
| FR-035 | 57 | Automatically synchronize offline changes across owner devices | Conflict/retry pending |
| FR-036 | 58 | Restore synchronized data on a replacement phone | Error handling pending |
| NFR-003 | 58 | Verify owner data recovery after device replacement | Retention/RTO/RPO pending |
| FR-037 | 59 | Authenticate the owner by email/password | Recovery/security rules pending |
| NFR-004 | 59 | Protect synchronized owner data with authentication | Measurable controls pending |
| FR-038 | 60 | Recover account through secure email reset | Link lifetime/error UX pending |
| DEC-052 | 61 | Keep the signed-in app usable offline without repeated password prompts | Device-loss mitigation pending |
| RISK-008 | 61 | Protect data on a lost signed-in phone | Mitigation pending |
| DEC-053 | 62 | Exclude app-specific biometric/PIN locking | Defined |
| DEC-054 | 63 | Exclude remote lost-device sign-out | Superseded in Turn 64 |
| DEC-055 | 64 | Sign out other devices after password reset | Defined; offline timing pending |
| FR-039 | 65 | Export reports as PDF and Excel | Report scope/layout pending |
| IR-004 | 65 | Generate phone-compatible PDF/Excel files | Sharing behavior pending |
| FR-040 | 66 | Filter reports before viewing/export | Report applicability pending |
| DEC-058 | 67 | Retain, mark, and retry failed synchronization | Defined; conflicts pending |
| NFR-005 | 67–69 | Preserve pending data and apply newest-edit conflict rule | Defined |
| DEC-059 | 69 | Resolve same-record conflicts using newest edit | Defined; overwrite risk accepted |
| RISK-009 | 69 | Older conflicting offline edit may be lost | Accepted |
| DEC-063 | 73 | Allow manual correction after conflict resolution | Defined |
| FR-042 | 75–79 | Recover eligible deleted records until manual permanent deletion | Eligible types pending |
| FR-043 | 76 | Prevent deletion of confirmed receipts | Confirmation trigger pending |
| FR-044 | 77 | Require review and explicit confirmation before printing | Validation pending |
| FR-045 | 78 | Generate a confirmed receipt as PDF | Layout/sharing pending |
| FR-046 | 81–85 | Require valid confirmation before business records become final | Record-specific validation pending |
| FR-047 | 83 | Save configuration settings without confirmation | Defined; lifecycle/dependency rules pending |
| FR-048 | 85–86 | Highlight confirmation-blocking errors, including invalid weights | Other record-specific validation pending |
| BR-022 | 86 | Require non-negative weights and full weight greater than empty weight | Defined |
| FR-049 | 88–90 | Validate a payment against the linked order's remaining balance | Correction-created overpayment handling pending |
| BR-023 | 90 | Require positive payments that do not exceed the remaining balance | Defined |
| BR-024 | 92 | Preserve payments and display correction-created overpayment | Defined |
| FR-050 | 93 | Automatically save in-progress business-record drafts | Autosave timing pending |
| DEC-077 | 94 | Move intentionally deleted business-record drafts to recoverable trash | Defined |
| FR-051 | 95 | Warn and require confirmation before permanent deletion | Defined |
| DEC-078 | 95 | Protect permanent deletion with explicit confirmation | Defined |
| NFR-003 | 58, 75, 79, 94–95, 97 | Permanently retain and restore synchronized confirmed records | Recovery timing pending |
| BR-025 | 97 | Prevent automatic expiration of confirmed records | Defined |
| FR-052 | 98–99 | Deactivate configuration options without changing history | Snapshot fields pending |
| DEC-080 | 99 | Preserve historical display while hiding inactive options from new records | Defined |
| DR-018 | 99–101 | Preserve the exact conversion values used on each confirmed receipt | Defined |
| DEC-081 | 101 | Store a permanent per-receipt copy of conversion values | Defined |
| DEC-082 | 102 | Select conversion from a dropdown and send confirmed receipts as PDF | Invoice-bill distinction pending |
| DEC-083 | 103 | Generate both delivery authorization and receipt as PDF | Defined |
| DEC-084 | 104 | Use two sendable/printable documents: delivery authorization and receipt/invoice bill | Defined |
| FR-041 | 70–72 | Correct receipts, overwrite prior values, and recalculate dependencies | Overpayment exception pending |
| DEC-061 | 71 | Retain only corrected receipt values | Defined; audit risk accepted |
| RISK-010 | 71 | Earlier receipt values cannot be audited | Accepted |
| IR-003 | 53 | Preserve records and permit retry after print failure | Error UX pending |

## 19. Open Questions and Unresolved Decisions

- OQ-001: Which parts of asphalt-plant management are intended to be covered, and where is the system boundary?
- OQ-002: What activities and records are included in “everything”?
- OQ-003: Closed through Turn 230 — five owner report groups, sections/columns, common filters, and PDF/Excel outputs are defined.
- OQ-004: Will the application replace paper records or supplement them?
- OQ-005: Closed in Turn 4 — both the owner's projects and external-customer supply are in scope.
- OQ-006: How should jobs, paving days, batches, trucks, drivers, destinations, and fuel records relate to one another?
- OQ-007: Which batch, truck/driver, and fuel details must be recorded?
- OQ-008: Closed through Turn 221 — post-weighing confirmation, document, signature, output, payment, and history behavior are defined.
- OQ-009: Closed in Turn 118 — net equals full minus empty in whole kilograms; asphalt uses 1,000 kg per ton and displays three decimal places to preserve exact kilogram precision.
- OQ-010: Closed through Turn 221 — external sale selection, pricing/VAT, payment tracking, pickup documents, saved customer history, and owner-only access are defined.
- OQ-011: Closed in Turn 134 — requested quantity is comparison-only, actual measured quantity controls billing, and no variance threshold or warning applies.
- OQ-012: Who oversees the plant during loading, and what is that person's responsibility?
- OQ-013: Closed in Turn 155 — one underlying record links customer, truck, weights, one batch, and one load; it appears in unified Load History and opens the full transaction/documents.
- OQ-014: Closed in Turn 109 — a priced receipt total equals converted quantity multiplied by price per selected output unit; order-linked payments are recorded and tracked without being processed by the app.
- OQ-015: Both documents share an immutable offline-safe number and original confirmation date/time; reprints show copy time. References, issuer, signatures, and other fields remain open.
- OQ-016: Closed in Turn 143 — the driver signs digitally; every printed/PDF delivery authorization includes the stored signature, the receipt does not, and shared transaction history shows Signed.
- OQ-017: How are document copies printed, distributed, or shared?
- OQ-018: Partially resolved in Turn 9 — manager only and changes persist as the default; audit remains open.
- OQ-019: Closed in Turn 112 — the owner may override a receipt price for one transaction without changing the saved default; only the dedicated settings section changes the default.
- OQ-020: Closed in Turn 11 — the same workflow applies and the owner's company is the customer for own projects.
- OQ-021: Closed for project identity in Turn 148 — every load has a customer; own-company loads and daily reports require a saved project; outside loads may optionally select one; project fields are defined. Batch associations remain under OQ-006/OQ-013.
- OQ-022: Closed in Turn 12 — own-project receipt price may be empty.
- OQ-023: Closed in Turn 125 — blank means Unpriced and is excluded from financial totals; intentional $0.00 is included as a zero-value order with no payment due.
- OQ-024: Closed in Turn 127 — each conversion defines displayed decimal places, all active options remain manually selectable, and billing uses the displayed rounded quantity before the USD total is rounded to cents.
- OQ-025: Closed through Turn 116 — whole non-negative kg, full greater than empty, derived net, direct correction/recalculation, and no prior-value history.
- OQ-026: Closed in Turn 15 — concrete is in scope for the first version.
- OQ-027: Corrected in Turn 19 — staff select material manually and select a saved conversion option separately on the receipt.
- OQ-028: Closed through Turn 123 — owner-configured conversions are independent of item/mix and all active options remain manually selectable.
- OQ-029: Closed in Turn 104 â€” concrete uses the common two-document setup: delivery authorization and receipt/invoice bill.
- OQ-030: Revised in Turn 46 — the owner controls conversion options in version one; staff support is deferred.
- OQ-031: Closed in Turn 123 — name, input/output units, rate, displayed decimal places, and active state are defined; all active options remain manually selectable without item filtering.
- OQ-032: Closed in Turn 101 â€” confirmed receipts permanently retain the conversion values used.
- OQ-033: The owner manages categories/items in version one; their exact semantics remain open.
- OQ-034: Closed through Turn 235 — rejected deliveries remain unconfirmed drafts, delete to recoverable Trash, and affect no totals, balances, inventory, or reports.
- OQ-035: Closed in Turn 177 — unit is cubic metres and the owner manually copies the quantity exactly from the supplier ticket/invoice.
- OQ-036: Closed through Turn 169 — payment fields, exactly-one-order linkage, partial balances/statuses, and final cancellation are defined.
- OQ-037: Closed in Turn 30 — quarry records do not update inventory.
- OQ-038: Closed in Turn 165 — each payment entry belongs to exactly one order; a real-world payment covering several orders is recorded as separate entries per order.
- OQ-039: Closed in Turn 128 — different items use separate receipts/history entries and totals remain separate by item and unit; unlike quantities are never combined.
- OQ-040: Revised in Turn 46 — the owner controls these settings in version one.
- OQ-041: Closed in Turn 33 — one report per project workday.
- OQ-042: Closed in Turn 36 — use worker/driver name, truck plate, and machine name.
- OQ-043: Which work-report fields are required?
- OQ-044: Closed through Turn 203 — the sole owner creates, edits, views, prints, and exports daily reports without approval or locking.
- OQ-045: Closed in Turn 181 — gauge reading establishes opening/correction baseline, deliveries add, equipment fills subtract, and plant consumption is excluded.
- OQ-046: Saved equipment requires name and may include type, plate/serial/internal code, and notes; fill-specific fields remain open.
- OQ-047: Closed in Turn 202 — created/last-updated timestamps only; no detailed edit history or prior versions.
- OQ-048: Closed in Turn 41 — manual physical-tank correction is required.
- OQ-049: Which fields and history are retained for fuel corrections?
- OQ-050: Closed in Turn 45 — the sole owner-user chooses dashboard summaries.
- OQ-051: Which filters and periods apply to dashboard summaries?
- OQ-052: Closed in Turn 46 — version one is owner-only; staff accounts are deferred.
- OQ-053: Closed in Turn 48 — support both Android and iPhone.
- OQ-054: Current Xprinter uses 58 mm paper and may be XP-POS-I100; exact model/protocol/printable width remains open.
- OQ-055: Closed through Turn 204 — confirmed records remain saved; Retry and Reconnect are offered; attempts remain original until first app-reported success; only successful later prints are marked and logged as copies.
- OQ-056: Closed in Turn 106 — version one supports selectable 58 mm and 80 mm POS paper layouts; other widths are deferred.
- OQ-057: Can the current Xprinter receive Bluetooth jobs from external Android/iPhone devices?
- OQ-058: Closed in Turn 54 — saved receipts can be reopened and reprinted repeatedly.
- OQ-059: Closed in Turn 57 — changes synchronize automatically and appear on another owner device.
- OQ-060: Closed in Turns 67â€“69 â€” failures remain pending and retry automatically; same-record conflicts use the newest edit.
- OQ-061: Closed in Turn 60 — email/password with secure email reset link.
- OQ-062: What backup retention and point-in-time recovery are needed?
- OQ-063: Closed in Turns 60–61 — email reset and persistent offline session.
- OQ-064: Closed as corrected in Turn 64 — local lock excluded; password reset signs out other devices.
- OQ-065: Which reports, filters, columns, and layouts require PDF/Excel export?
- OQ-066: Closed in Turn 71 — retain only corrected values, without change history.
- OQ-067: Closed in Turn 72 — all listed dependent quantities, totals, balances, summaries, and future prints recalculate.
- OQ-068: Closed in Turn 92 — keep recorded payments unchanged, display the excess as an overpaid amount, and do not process refunds.
- OQ-069: Closed in Turn 105 â€” only intentionally deleted business-record drafts enter trash; confirmed records are non-deletable and configuration options use deactivation.
- OQ-070: Closed in Turn 78 — drafts are editable/deletable; explicit confirmation makes the receipt saved, printable, PDF-capable, and non-deletable.
- OQ-071: Which validation rules block confirmation, and can confirmation be undone?
- OQ-072: Closed in Turn 94 — business-record drafts autosave, and intentionally deleted drafts move to recoverable trash.
- OQ-073: Closed in Turn 83 — lifecycle applies to business records; settings save directly.
- OQ-074: Receipt weight rules are defined: weights must be non-negative and full weight must exceed empty weight. Which price, payment, overpayment, and other record-specific validations are required?
- OQ-075: Closed in Turn 90 — each recorded payment must be greater than zero and cannot exceed the linked order's remaining balance.
- OQ-076: Closed in Turn 95 — permanent deletion from trash requires a warning and explicit confirmation.
- OQ-077: Closed in Turn 97 — all synchronized confirmed records remain permanently available for long-term history and replacement-phone restoration.
- OQ-078: Closed in Turn 99 — deactivate unused options for new selections, preserve their historical display, and permit reactivation.
- OQ-079: Closed in Turn 101 — every confirmed receipt permanently stores its own conversion name, units, rate, source quantity, and calculated quantity.
- OQ-080: Closed in Turn 104 — receipt and invoice bill are the same document; the final set is delivery authorization plus receipt/invoice bill.
- OQ-081: Closed in Turn 114 — version one uses USD for all financial values; mixed currencies and currency conversion are out of scope.
- OQ-082: Closed in Turn 159 — numeric-priced receipts use universal VAT; zero produces zero VAT; Unpriced has none; documents show subtotal/rate/amount/final total; confirmed receipts retain their applied rate.
- OQ-083: Closed in Turn 163 — warnings do not block; optional manual merge uses preview/confirmation, moves associations, recalculates summary, archives the duplicate, and preserves issued document contents; profiles may remain separate.

## 20. Appendices

No appendices yet.
