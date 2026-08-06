# Software Requirements Specification

## 1. Document Control

- Status: Initial draft
- Version: 0.95
- Last updated: 2026-08-06
- Interview status: In progress; initial vision and current recordkeeping approach identified

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

After final weighing, two documents are required: a delivery authorization and a receipt, with the receipt also referred to as the invoice bill. There is no third invoice document. The delivery authorization contains the company name, driver name, plate number, empty weight, full weight, net weight, converted net weight in tons, destination address, and a signature. The receipt/invoice bill contains net weight and price. Both documents can be printed, generated as PDF, and sent from the phone. (Sources: Turns 7 and 102–104; status: Confirmed at document-set level.)

This workflow applies to both outside work and the owner's projects. For an owner project, the owner's company is recorded as the customer. (Sources: Turns 10–11; status: Confirmed.)

Concrete follows the same basic workflow as asphalt: empty truck weighing, loading, full truck weighing, record creation, and receipt or invoice generation. (Source: Turn 15; status: Confirmed; exact document combination pending.)

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
- Trigger: An asphalt batch is produced.
- Preconditions: The authorized user can identify the batch.
- Main behavior: Record the batch and retain it in production history.
- Alternate and exception behavior: Handling missed, corrected, cancelled, or duplicate batch entries remains to be elicited.
- Postconditions: The batch can be retrieved in historical records and used in statistics.
- Priority: Must
- Acceptance criteria: Required batch fields, recording timeliness, and completeness threshold remain to be elicited.
- Source: Interview turn 3
- Status: Draft

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
- Preconditions: The customer and supplied quantity can be identified.
- Main behavior: Associate the supplied asphalt quantity with the customer's transaction record.
- Alternate and exception behavior: Anonymous or one-time customers, corrections, cancelled orders, returns, and measurement discrepancies remain to be elicited.
- Postconditions: The transaction contributes to the customer's history.
- Priority: Must
- Acceptance criteria: For any recorded external transaction, an authorized user can retrieve the customer and supplied quantity; measurement unit and other fields remain to be confirmed.
- Source: Interview turn 4
- Status: Draft

### FR-007
- Statement: “The system shall provide an authorized user with the historical asphalt quantities recorded for an external customer.”
- Rationale: The owner wants individuals and companies to have a transaction history.
- Actors: Plant owner; other authorized users and any customer access remain to be identified.
- Trigger: An authorized user opens a customer's history.
- Preconditions: The customer has recorded transactions.
- Main behavior: Display the customer's recorded asphalt-supply transactions and quantities.
- Alternate and exception behavior: Behavior when no history exists or customer records are duplicated remains to be elicited.
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
- Main behavior: Accept manual entry of empty and full weights in kilograms and store both measurements as part of the load record.
- Alternate and exception behavior: Missing measurements, reweighing, corrections, weighbridge failure, and multiple loads remain to be elicited.
- Postconditions: The collection record contains the available pre-load and post-load weights.
- Priority: Must
- Acceptance criteria: An authorized user can manually enter and later retrieve the empty and full kilogram weights for a completed truck load.
- Source: Interview turns 6, 10–11, and 13
- Status: Confirmed at workflow level

### FR-009
- Statement: “The system shall record the desired asphalt weight for each applicable truck load.”
- Rationale: Loading is performed based on the weight requested by the customer.
- Actors: Personnel accepting or fulfilling the project or customer request; exact role to be identified.
- Trigger: A desired amount of asphalt is specified for a load.
- Preconditions: The associated own project or outside project/customer is identifiable.
- Main behavior: Store the desired weight with the collection record and make it available to relevant operational personnel.
- Alternate and exception behavior: Changes, maximum truck capacity, and invalid requests remain to be elicited.
- Postconditions: The target is available for comparison with the loaded quantity and associated with the relevant project/customer.
- Priority: Must
- Acceptance criteria: A collection record shows the customer's desired weight and the recorded final weighbridge measurements.
- Source: Interview turns 6 and 10
- Status: Draft

### FR-010
- Statement: “The system shall generate a delivery authorization for every completed asphalt load, whether for an owner project or an outside customer.”
- Rationale: The delivery authorization is one of two required documents after loading.
- Actors: Authorized plant personnel; recipient and issuer roles remain to be identified.
- Trigger: The truck has completed final weighing and the load record is ready for authorization.
- Preconditions: Required customer, driver, vehicle, weight, destination, and signature information is available.
- Main behavior: Generate a delivery authorization containing company name, driver name, plate number, empty weight, full weight, net weight, net weight converted to tons, destination address, and signature.
- Alternate and exception behavior: Missing data, corrections, reprints, cancellations, and voiding remain to be elicited.
- Postconditions: The authorization is associated with the load record and available in the required output form.
- Priority: Must
- Acceptance criteria: A generated authorization displays all fields confirmed in Turn 7 with values associated with the correct load.
- Source: Interview turns 7 and 10–11
- Status: Confirmed at workflow level; field behavior remains draft

### FR-011
- Statement: “The system shall generate a receipt for every completed asphalt load, whether for an owner project or an outside customer.”
- Rationale: A receipt showing net weight and price is required after loading.
- Actors: Authorized plant personnel; recipient and issuer roles remain to be identified.
- Trigger: The load's net weight and applicable price are available.
- Preconditions: The completed load is identifiable.
- Main behavior: Generate a receipt containing the net weight and, for a priced transaction, the price using the applicable editable price per ton. Permit the price to be empty for an owner-project load.
- Alternate and exception behavior: Owner-project price may be empty. Credit sales, partial payment, corrections, refunds, cancellations, and reprints remain to be elicited.
- Postconditions: The receipt is associated with the customer load record and available in the required output form.
- Priority: Must
- Acceptance criteria: Every completed load can produce a receipt showing its net weight; an owner-project receipt can be saved and generated without a price; outside-sale price calculation remains to be defined.
- Source: Interview turns 7 and 10–12
- Status: Partially confirmed

### FR-012
- Statement: “The system shall allow an authorized user to set or change the price per ton used for an outside-customer transaction.”
- Rationale: The applicable price per ton may vary.
- Actors: Plant owner/manager.
- Trigger: A transaction requires a per-ton price different from the currently presented price.
- Preconditions: The authenticated user has the manager role.
- Main behavior: Accept the new price per ton and make it the default for subsequent sales until the manager changes it again.
- Alternate and exception behavior: Invalid prices, transaction-specific overrides, post-issuance changes, and audit behavior remain to be elicited.
- Postconditions: The new default price per ton is retained and presented for subsequent sales.
- Priority: Must
- Acceptance criteria: The manager can change the default price per ton; a later sale uses the changed default unless it has since been changed again; a non-manager cannot change the default.
- Source: Interview turns 8–9
- Status: Confirmed

### FR-013
- Statement: “The system shall associate each recorded asphalt load with either an owner project or an outside project/customer.”
- Rationale: All work in both categories must be recorded and distinguishable in history.
- Actors: Authorized operational personnel; exact roles remain to be identified.
- Trigger: A load record is created.
- Preconditions: The relevant project or customer context is known.
- Main behavior: Classify and link the load to the applicable owner project or outside project/customer.
- Alternate and exception behavior: Unassigned, mixed-purpose, or corrected loads remain to be elicited.
- Postconditions: The load appears in the correct project or customer history.
- Priority: Must
- Acceptance criteria: An authorized user can retrieve load histories separately for owner projects and outside projects/customers.
- Source: Interview turn 10
- Status: Draft

### FR-014
- Statement: “The system shall calculate net weight in kilograms as full weight minus empty weight.”
- Rationale: Net supplied asphalt weight must be derived from the two manually entered weighbridge readings.
- Actors: System; authorized record-entry user.
- Trigger: Both empty and full weights are entered or changed.
- Preconditions: Both readings are present in kilograms and pass applicable validation.
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
- Main behavior: Show active saved conversion rates in a dropdown, apply the option manually selected by the owner, and present the result in that option's output unit; the asphalt option uses 1,000 kg = 1 ton.
- Alternate and exception behavior: Behavior without a conversion, invalid configuration, and changes affecting historical records remain to be defined.
- Postconditions: The converted quantity is available to documents, history, reports, and pricing.
- Priority: Must
- Acceptance criteria: A receipt preparer can choose an active saved conversion rate from a dropdown; the receipt uses the chosen option; choosing the asphalt 1,000 kg/ton option produces 1 ton for 1,000 net kg.
- Additional source: Interview turn 102
- Source: Interview turns 13–14 and 18–19
- Status: Confirmed behavior; permissions and rounding pending

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
- Main behavior: Save a reusable conversion option for later receipt selection.
- Alternate and exception behavior: Duplicate, invalid, edited, deactivated, or deleted rates and historical impact remain to be defined.
- Postconditions: The option is available for permitted receipt workflows.
- Priority: Must
- Acceptance criteria: The owner can add or change a valid conversion option and subsequently select it while preparing a receipt.
- Source: Interview turns 19–20 and 46
- Status: Confirmed for version one; fields pending

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
- Main behavior: Create and retain a named item associated with the category.
- Alternate and exception behavior: Duplicate names, movement between categories, editing, deactivation, deletion, and item-specific behavior remain to be defined.
- Postconditions: The item is available for applicable records and reports.
- Priority: Must
- Acceptance criteria: The owner can create an item under a selected category and later select it in an applicable record.
- Source: Interview turns 21, 28, and 46
- Status: Confirmed behavior; lifecycle pending

### FR-020
- Statement: “The system shall record each incoming quarry-truck purchase.”
- Rationale: The owner needs to see how much material is purchased and whether it has been paid.
- Actors: Authorized purchasing or receiving staff; exact roles remain to be confirmed.
- Trigger: A truck delivers a purchased item from a quarry.
- Preconditions: The quarry/supplier and item can be identified.
- Main behavior: Accept the delivered quantity directly, without requiring empty/full weighbridge entries, and record the quarry, item, driver, plate number, and payment information without processing the payment.
- Alternate and exception behavior: Multiple trucks per purchase, rejected loads, corrections, partial payment, and missing documents remain to be elicited.
- Postconditions: The delivery is available in quarry purchase and payment history; no inventory balance is changed.
- Priority: Must
- Acceptance criteria: An authorized user can save and retrieve a quarry delivery containing quarry, item, cubic-metre quantity, driver, plate number, and payment information without empty/full weight fields; saving it does not alter inventory.
- Source: Interview turns 21–22 and 26–30
- Status: Draft

### FR-021
- Statement: “The system shall display a customer profile summary containing total quantity taken and total price.”
- Rationale: The owner needs an immediate overview of each customer's activity and value.
- Actors: Owner.
- Trigger: An authorized user opens a customer profile.
- Preconditions: The customer profile exists and has zero or more orders.
- Main behavior: Aggregate the customer's recorded order quantities and prices and present the totals.
- Alternate and exception behavior: Multiple items/units, blank own-company prices, cancelled orders, and date filtering remain to be defined.
- Postconditions: The user can see the customer's current aggregate summary.
- Priority: Must
- Acceptance criteria: The profile displays totals derived from the customer's included orders; unit grouping and inclusion rules remain pending.
- Source: Interview turn 23
- Status: Draft

### FR-022
- Statement: “The system shall display every recorded order associated with a customer in that customer's history.”
- Rationale: The owner needs to review all customer orders and their payment state.
- Actors: Owner.
- Trigger: An authorized user opens customer history.
- Preconditions: The customer profile exists.
- Main behavior: List the customer's orders with quantity, price, paid/unpaid status, amount paid, payment date, and remaining balance where applicable.
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
- Alternate and exception behavior: Multiple partial payments are allowed for the same order. Overpayment, reversal, and one real-world payment across multiple orders remain to be defined.
- Postconditions: The customer profile and order history reflect the recorded payment.
- Priority: Must
- Acceptance criteria: Recording several partial payments against order 1 creates separate dated entries under order 1, does not attach them to order 2, and updates order 1's total paid and remaining balance without executing a financial transfer.
- Source: Interview turns 22–25
- Status: Confirmed for single-order partial payments

### FR-024
- Statement: “The system shall display the payment history for a selected customer order.”
- Rationale: Users need to see how much was paid and when for each specific order.
- Actors: Owner.
- Trigger: An authorized user views an order's payment details.
- Preconditions: The order exists.
- Main behavior: List every payment entry linked to that order with its amount and date.
- Alternate and exception behavior: An order with no payments displays an empty payment history and its full unpaid balance.
- Postconditions: The user can reconcile the order's total paid and remaining balance with its payment entries.
- Priority: Must
- Acceptance criteria: The sum of listed payment amounts equals the order's displayed amount paid, and each entry shows its recorded date.
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
- Trigger: Delivered fuel litres are entered, fuel is issued to a machine, or stock is corrected.
- Preconditions: A fuel item and applicable unit exist.
- Main behavior: Calculate a tracked balance as delivered litres minus litres issued to machines; plant consumption is excluded.
- Alternate and exception behavior: Initial balance, stock additions, corrections, losses, and reconciliation remain to be defined.
- Postconditions: The displayed tracked balance reflects recorded deliveries and machine issues but may not equal physical stock.
- Priority: Must
- Acceptance criteria: Entering L delivered litres increases the tracked balance by L; recording M litres issued to a machine decreases it by M; no plant-consumption amount is subtracted.
- Source: Interview turns 32 and 39–40
- Status: Confirmed formula; labeling/correction pending

### FR-027
- Statement: “The system shall record each machine refuelling with the machine and fuel amount.”
- Rationale: Machine fuel consumption must be traceable.
- Actors: Authorized operational staff; exact role remains to be confirmed.
- Trigger: A machine is filled with fuel.
- Preconditions: The machine and fuel amount can be identified.
- Main behavior: Save a refuelling transaction and reduce fuel stock by the recorded amount.
- Alternate and exception behavior: Corrections, cancelled entries, multiple fuel types, and insufficient recorded stock remain to be defined.
- Postconditions: The machine's fuel history contains the transaction and the fuel balance is updated.
- Priority: Must
- Acceptance criteria: A saved refuelling shows the selected machine and amount and is reflected in fuel history and balance.
- Source: Interview turn 32
- Status: Draft

### FR-028
- Statement: “The system shall allow a project foreman to create one daily work report for each project workday.”
- Rationale: The foreman needs to document what occurred during work.
- Actors: Project foreman.
- Trigger: Work occurs on a project during a calendar workday.
- Preconditions: The project and foreman are identifiable.
- Main behavior: Create the project's report for that workday and allow manual entry of worker and driver names, truck plate numbers, machine names, what happened, and material entries containing item, quantity, unit, and used/transported classification.
- Alternate and exception behavior: The report remains editable after saving and does not require approval or locking. No activity, late entry, attachments, and audit history remain to be defined.
- Postconditions: The editable report is retained in project history.
- Priority: Must
- Acceptance criteria: A foreman can save one report for a selected project/work date with presence entries and material entries that each identify an item, quantity, unit, and whether it was used or transported.
- Source: Interview turns 32–37
- Status: Partially confirmed; activity/output fields pending

### FR-029
- Statement: “The system shall allow an authorized user to manually correct the recorded fuel balance after checking the physical tank.”
- Rationale: Plant fuel consumption is not measurable through the system, so calculated stock can differ from actual stock.
- Actors: Owner.
- Trigger: A physical tank check shows a different amount from the recorded balance.
- Preconditions: The actual tank quantity in litres is known.
- Main behavior: Replace the current recorded fuel balance with the manually entered actual litre amount.
- Alternate and exception behavior: Invalid values, cancellation, and correction history remain to be defined.
- Postconditions: The recorded balance equals the entered physical-tank amount and subsequent movements use it as the current baseline.
- Priority: Must
- Acceptance criteria: Entering a valid physical-tank quantity changes the current recorded balance to that quantity without altering prior delivery or machine-refuelling records.
- Source: Interview turns 40–41
- Status: Confirmed behavior; audit fields pending

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
- Main behavior: Offer known summaries including today's loads, unpaid orders, fuel balance, quarry totals, and missing daily reports, and allow visible summaries to be chosen.
- Alternate and exception behavior: Empty data, unavailable widgets, and default selection remain to be defined.
- Postconditions: The dashboard displays the selected summaries.
- Priority: Must
- Acceptance criteria: Each known summary can be shown or hidden, while “Make Receipt” remains prominently available.
- Source: Interview turn 44
- Status: Confirmed for single-user preference; widget details pending

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
- Main behavior: Send another copy to the selected printer without changing the receipt record.
- Alternate and exception behavior: Print failure does not change the saved receipt.
- Postconditions: Another physical copy is produced when printing succeeds.
- Priority: Must
- Acceptance criteria: The owner can print multiple copies, leave the receipt screen, reopen the saved receipt from history, and print it again.
- Source: Interview turns 53–54
- Status: Confirmed

### FR-034
- Statement: “The system shall support core application workflows without an internet connection.”
- Rationale: The owner works where internet may be unavailable.
- Actors: Owner.
- Trigger: The device has no internet connection.
- Preconditions: The app is installed and accessible.
- Main behavior: Allow creation/editing of in-scope records, receipt creation/saving, Bluetooth printing, and daily-report creation/editing using local data.
- Alternate and exception behavior: Functions requiring unavailable remote data, synchronization, and storage exhaustion remain to be defined.
- Postconditions: Offline changes are retained locally without data loss.
- Priority: Must
- Acceptance criteria: With network disabled, the owner can create and reopen a receipt, print over Bluetooth, create/edit a daily report, and retain changes after restarting the app.
- Source: Interview turn 56
- Status: Confirmed for core workflows; synchronization pending

### FR-035
- Statement: “The system shall automatically synchronize locally retained offline changes when internet connectivity returns.”
- Rationale: The owner needs offline continuity and the same data on another phone.
- Actors: System; owner.
- Trigger: Connectivity becomes available while unsynchronized changes exist.
- Preconditions: The device can authenticate to the synchronization service.
- Main behavior: Upload local changes and make the synchronized data available to the owner's other device.
- Alternate and exception behavior: On failure, retain local changes, show them as pending, and retry automatically. If the same record changed on two offline devices, keep the newest edit. The owner may then manually correct that resulting record.
- Postconditions: Successfully synchronized records are durable remotely and available on other signed-in owner devices.
- Priority: Must
- Acceptance criteria: Create conflicting edits on two devices, verify the newest edit is retained, then manually correct the resulting record and verify the correction synchronizes.
- Source: Interview turns 57 and 67
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
- Main behavior: Allow applicable filtering by date range, category/item, customer/project, and paid/unpaid status, then produce a PDF or Excel file representing the filtered report.
- Alternate and exception behavior: Empty results, offline export, file-generation failure, large reports, sharing, and printing remain to be defined.
- Postconditions: The generated file is available on the phone for the owner.
- Priority: Must
- Acceptance criteria: Applying supported filters changes the displayed/exported dataset consistently; PDF and Excel exports contain the same records within the selected filter scope.
- Source: Interview turns 65–66
- Status: Confirmed formats and common filters; report layouts pending

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
- Alternate and exception behavior: A confirmed receipt cannot be deleted or moved to trash. Business-record drafts are eligible for trash. Eligible trash records remain until the owner manually permanently deletes them; references and eligibility of other record types remain to be defined.
- Postconditions: The record is recoverable from trash and excluded from active workflows.
- Priority: Must
- Acceptance criteria: A deleted business-record draft moves to trash and can be restored. It remains restorable beyond 30 days and disappears permanently only after the owner manually deletes it from trash; confirmed receipt deletion is rejected.
- Additional source: Interview turn 94
- Source: Interview turns 75–76 and 79
- Status: Confirmed for drafts and retention; other eligible types pending

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
- Acceptance criteria: A receipt missing customer, plate, or required weights cannot confirm, and each missing value is visibly identified. Negative empty or full weights are rejected. A full weight less than or equal to the empty weight blocks confirmation and visibly identifies the invalid weight relationship.
- Source: Interview turns 85–86
- Status: Confirmed for required fields and weight validation; other record-specific rules pending

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
- The customer's desired asphalt weight is used as the target when loading the truck. Required precision and tolerance remain unknown. (Source: Turn 6; status: Draft.)

### BR-003
- Each completed outside-customer load requires both a delivery authorization and a receipt. (Source: Turn 7; status: Confirmed.)

### BR-004
- The price per ton is variable. Only the manager may change it, and the changed price becomes the default for future sales until the manager changes it again. (Sources: Turns 8–9; status: Confirmed.)

### BR-005
- No asphalt work is exempt from recording solely because it is for the owner's own project rather than an outside project/customer. (Source: Turn 10; status: Confirmed.)

### BR-006
- The owner's company shall be treated as the customer for loads serving its own projects, and those loads shall follow the same operational and document workflow as outside-customer loads. (Source: Turn 11; status: Confirmed.)

### BR-007
- The price field may be empty on a receipt for an owner-project load. The default behavior and reporting semantics of blank versus zero remain to be confirmed. (Source: Turn 12; status: Confirmed in principle.)

### BR-008
- Net kilograms equal full kilograms minus empty kilograms. (Source: Turn 13; status: Confirmed.)

### BR-009
- Asphalt conversion shall use 1,000 kg = 1 ton. Other conversions shall use the selected configured rate and output unit. Material/mix applicability, permissions, and rounding remain to be confirmed. (Sources: Turns 13–14; status: Partially confirmed.)

### BR-010
- Asphalt and concrete shall use the same basic empty-weigh, load, full-weigh, calculate, record, and document workflow. (Source: Turn 15; status: Confirmed.)

### BR-011
- Staff shall select the load material manually. While preparing the receipt, the user shall separately select an appropriate saved conversion-rate option. (Sources: Turns 18–19; status: Confirmed as corrected.)

### BR-012
- Categories and items are business-configurable and shall not be hard-coded to asphalt and concrete. (Source: Turn 21; status: Confirmed.)

### BR-013
- Payments occur in person outside the system. The system only records and tracks payment information. (Source: Turn 22; status: Confirmed.)

### BR-014
- Customer profiles shall aggregate their recorded orders and expose each order's paid/unpaid state and remaining balance. Aggregation by item/unit and payment allocation rules remain to be defined. (Source: Turn 23; status: Partially confirmed.)

### BR-015
- An order may receive multiple partial payments. Each payment is linked to that order, and remaining balance equals order total less the sum of its linked payment amounts. (Sources: Turns 24–25; status: Confirmed.)

### BR-016
- A quarry delivery records its quantity directly and does not require the empty/full weighbridge workflow used for outgoing loads. (Source: Turn 26; status: Confirmed.)

### BR-017
- Quarry delivery quantity is recorded in cubic metres. Measurement units are configurable rather than limited to hard-coded choices. (Source: Turn 27; status: Confirmed.)

### BR-018
- Quarry delivery records are for quantity and payment tracking only and shall not modify an inventory or stock balance. (Source: Turn 30; status: Confirmed.)

### BR-019
- Tracked fuel balance equals recorded delivered litres minus litres issued to machines. Plant fuel consumption is excluded, so the result may differ from physical stock. (Sources: Turns 32 and 39–40; status: Confirmed with limitation.)

### BR-020
- Daily project reports remain editable after saving and require no approval or locking in the current workflow. (Source: Turn 38; status: Confirmed.)

### BR-021
- A manual physical-tank correction resets the current fuel-balance baseline but shall not rewrite prior fuel delivery or machine-refuelling records. (Source: Turn 41; status: Derived requirement pending confirmation of audit details.)

### BR-022
- Empty and full weight values shall be non-negative, and the full weight must be greater than the empty weight before a receipt can be confirmed. (Source: Turn 86; status: Confirmed.)

### BR-023
- A payment linked to an order must be greater than zero and cannot exceed that order's current remaining balance. (Source: Turn 90; status: Confirmed.)

### BR-024
- Receipt or order corrections shall not alter existing payment records. When recorded payments exceed a corrected order total, the difference shall be shown as an overpaid amount. (Source: Turn 92; status: Confirmed.)

### BR-025
- Synchronized confirmed business records shall not expire or be deleted automatically; they shall remain permanently available. (Source: Turn 97; status: Confirmed.)

## 11. Data Requirements

### DR-001
- The system shall store in-scope asphalt-plant management records digitally. The entities, attributes, ownership, validation, lifecycle, retention, classification, and migration needs remain to be elicited. (Source: Turn 2; status: Draft.)

### DR-002
- The conceptual data model shall include production batches, paving days, trucks, drivers, and fuel records, subject to clarification of their attributes and relationships. (Source: Turn 3; status: Draft.)

### DR-003
- The system shall distinguish external individual customers from external company customers and associate each with their asphalt-supply transactions and quantities. Customer attributes, quantity units, duplicate handling, and retention remain to be elicited. (Source: Turn 4; status: Draft.)

### DR-004
- Each truck load shall retain the desired weight, manually entered empty weight in kilograms, manually entered full weight in kilograms, calculated net kilograms, conditionally calculated net tons, and identifiers needed to associate the measurements with the load. Precision, timestamps, vehicle identifiers, and correction history remain to be elicited. (Sources: Turns 6, 10–11, and 13; status: Draft.)

### DR-005
- A delivery authorization shall include company name, driver name, plate number, empty weight, full weight, net weight, net weight in tons, destination address, and signature. The signature owner, original weight unit, conversion, precision, identifiers, timestamps, and additional fields remain to be confirmed. (Source: Turn 7; status: Draft.)

### DR-006
- A receipt shall include net weight. For priced transactions, it shall retain the applicable price per ton and price; for owner-project transactions, price may be null rather than zero. Other commercial, payment, customer, numbering, and timestamp fields remain to be elicited. (Sources: Turns 7–8 and 12; status: Draft.)

### DR-007
- Each load record shall identify whether it belongs to an owner project or an outside project/customer and retain the corresponding association. Project identifiers and attributes remain to be elicited. (Source: Turn 10; status: Draft.)

### DR-008
- Customer records shall support the owner's company as a customer so its own-project loads appear in customer history. (Source: Turn 11; status: Confirmed conceptually.)

### DR-009
- A saved conversion option shall retain its rate, input unit, output unit, and selection identity. Its name, material association, active state, permissions, and historical version behavior remain to be elicited. (Sources: Turns 14 and 19; status: Draft.)

### DR-010
- Each load shall retain a material classification of asphalt or concrete. Future extensibility and any material subtype or mix association remain to be defined. (Source: Turn 15; status: Draft.)

### DR-011
- The conceptual model shall include categories and items, with each item associated with a category. Names, identifiers, status, validation, and item-specific attributes remain to be defined. (Source: Turn 21; status: Draft.)

### DR-012
- A quarry purchase record shall include quarry/supplier, item, directly entered quantity in cubic metres, driver, vehicle plate number, payment status/history, and a truck-level identity. Quantity source, date/reference, and other attributes remain to be elicited. (Sources: Turns 21 and 26–29; status: Draft.)

### DR-013
- A customer order shall retain its customer, item/load references, quantity, price, derived total paid, remaining balance, and payment status. It shall relate to zero or more separate payment entries. (Sources: Turns 23–25; status: Draft.)

### DR-014
- Each payment entry shall retain its amount, payment date, and association with exactly one customer order. Additional fields and multi-order real-world payment handling remain open. (Source: Turn 25; status: Draft.)

### DR-015
- A measurement unit shall retain a name or symbol and identifier. Associations, validation, lifecycle, and historical behavior remain to be defined. (Source: Turn 27; status: Draft.)

### DR-016
- The conceptual model shall include fuel-stock movements, physical-balance corrections, and machines. A fuel delivery contains litres delivered; a machine-refuelling contains machine and amount; a correction contains the actual litre amount. Date/time, actor, reason, and prior balance remain to be confirmed. (Sources: Turns 32 and 39–41; status: Draft.)

### DR-017
- A project daily work report shall be associated with one project and work date and retain its foreman/author, activity description, manual worker/driver names, truck plates, machine names, and material entries containing item, quantity, unit, and used/transported classification. Lifecycle and remaining fields remain to be elicited. (Sources: Turns 32–37; status: Draft.)

### DR-018
- Each confirmed receipt shall store the conversion name, input unit, output unit, conversion rate, source weight or quantity, and calculated converted quantity used at confirmation. These stored values shall remain unchanged by later configuration edits, deactivation, or reactivation. (Sources: Turns 99–101; status: Confirmed.)

## 12. External Interface and Integration Requirements

### IR-001
- The application shall print receipts from Android and iPhone to both the existing Xprinter Android POS terminal and compatible separate portable Bluetooth printers, using configurable layouts. The existing device uses 58 mm paper and may be model XP-POS-I100; integration interfaces and portable-printer compatibility remain to be validated. (Sources: Turns 47–52; status: Confirmed scope, technical details draft.)

### IR-002
- Receipt formatting shall adapt to a selected supported roll/print width rather than assuming one fixed width. The current device uses 58 mm paper; printable width and the complete supported width list remain open. (Sources: Turns 49–51; status: Draft.)

### IR-003
- Printer unavailability or print failure shall not prevent receipt persistence. The application shall permit another print attempt while the receipt is open. Detailed error messages and reconnection behavior remain to be defined. (Source: Turn 53; status: Partially confirmed.)

### IR-004
- The application shall generate reports in PDF/Excel-compatible formats and individual confirmed receipts as PDF files that can be stored or shared using phone capabilities. Sharing behavior remains to be confirmed. (Sources: Turns 65 and 78; status: Draft.)

## 13. Non-Functional Requirements

### NFR-001 — Portability
- The version-one user experience shall support both Android phones and iPhones. Screen-size baseline, minimum OS versions, and verification devices remain to be confirmed. (Sources: Turns 47–48; status: Confirmed at platform level.)

### NFR-002 — Availability and Offline Operation
- Core workflows shall remain available without internet and offline changes shall synchronize automatically after connectivity returns. Verification: execute FR-034 offline on Android and iPhone, restore connectivity, and verify FR-035 cross-device visibility. (Sources: Turns 56–57; status: Partially confirmed; recovery/conflict details pending.)

### NFR-003 — Backup and Recovery
- All synchronized confirmed records shall remain available permanently with no automatic expiration and shall be recoverable on a replacement device. Eligible deleted drafts shall remain in trash until manually permanently deleted after confirmation. Verification: restore all confirmed records to a replacement device and execute the FR-036/FR-042 scenarios beyond 30 days. Point-in-time historical versions and recovery timing remain to be defined. (Sources: Turns 58, 75, 79, 94–95, and 97; status: Partially confirmed.)

### NFR-005 — Reliability
- A failed synchronization attempt shall not lose locally saved records. Pending changes shall remain identifiable and retry automatically. Same-record conflicts shall retain the newest edit. Verification: inject failures and conflicting timestamps, then verify durability, pending indication, retry, and newest-edit result. (Sources: Turns 67–69; status: Confirmed.)

### NFR-004 — Security
- Initial access shall require email/password authentication. After initial sign-in, access remains available offline without repeated prompts. App-specific biometric/PIN locking is excluded. A successful password reset shall revoke all other device sessions once they can receive the revocation. Password storage, transport protection, reset security, revocation timing, and brute-force controls require measurable definition. (Sources: Turns 59–64; status: Draft.)

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

## 16. Acceptance and Success Criteria

- The owner confirmed that the scope summarized through Turn 42 accurately reflects the intended product direction. Measurable operational success criteria remain to be elicited.
- Receipt creation must be directly accessible from the home screen. (Source: Turn 44.)
- The owner confirmed the single-user Android/iPhone, durable receipt history, and repeated Bluetooth-printing scope through Turn 55.
- The owner confirmed the consolidated Draft → Review → Confirm lifecycle, confirmed-record correction/non-deletion, manual trash retention, and receipt weight-validation scope through Turn 87.

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
- Cross-platform Bluetooth printing cannot be treated as universally compatible across all POS printers and sizes without defining supported protocols, models, and paper widths. (Source: Turn 49; status: Open.)

### RISK-008
- Persistent offline access may expose business/customer data if a signed-in phone is lost. Password-reset session revocation is required, but a lost phone that remains offline may retain access until it reconnects; app-specific local locking is excluded. (Sources: Turns 61–64; status: Partially mitigated.)

### RISK-009
- Newest-edit-wins conflict handling may silently discard an older offline edit. This is accepted for simplicity in the single-user release. (Source: Turn 69; status: Accepted.)

### RISK-010
- Direct receipt correction without prior-value history reduces auditability and prevents reconciliation with copies printed before correction. The owner accepts this for simplicity. (Source: Turn 71; status: Accepted.)

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
- OQ-003: Which reports are needed, by whom, and for which decisions?
- OQ-004: Will the application replace paper records or supplement them?
- OQ-005: Closed in Turn 4 — both the owner's projects and external-customer supply are in scope.
- OQ-006: How should jobs, paving days, batches, trucks, drivers, destinations, and fuel records relate to one another?
- OQ-007: Which batch, truck/driver, and fuel details must be recorded?
- OQ-008: Partially resolved in Turn 7 — delivery authorization and receipt are created; payment handling remains open.
- OQ-009: How are net weight and tons calculated, including units, conversion, precision, and rounding?
- OQ-010: Which commercial and delivery details are included in an external sale?
- OQ-011: What happens when the loaded quantity differs from the customer's desired weight?
- OQ-012: Who oversees the plant during loading, and what is that person's responsibility?
- OQ-013: Should each final weight be linked to the customer, truck, and production batches?
- OQ-014: Is receipt total net tons multiplied by price per ton, and how is payment recorded?
- OQ-015: Which additional document fields are required?
- OQ-016: Who signs the delivery authorization, and in what form?
- OQ-017: How are document copies printed, distributed, or shared?
- OQ-018: Partially resolved in Turn 9 — manager only and changes persist as the default; audit remains open.
- OQ-019: Can the manager override price for one transaction without changing the future default?
- OQ-020: Closed in Turn 11 — the same workflow applies and the owner's company is the customer for own projects.
- OQ-021: What identifies each project, and must every batch and load be linked to one?
- OQ-022: Closed in Turn 12 — own-project receipt price may be empty.
- OQ-023: Should own-project price default to blank, and how should blank differ from zero in reports?
- OQ-024: Asphalt conversion is confirmed as 1,000 kg/ton; other conversion permissions, material/mix applicability, units, precision, and rounding remain open.
- OQ-025: What validation and correction controls apply to manually entered weights?
- OQ-026: Closed in Turn 15 — concrete is in scope for the first version.
- OQ-027: Corrected in Turn 19 — staff select material manually and select a saved conversion option separately on the receipt.
- OQ-028: Multiple concrete conversion options may be saved and selected; their association with mixes remains open.
- OQ-029: Does concrete produce both documents or one receipt/invoice?
- OQ-030: Revised in Turn 46 — the owner controls conversion options in version one; staff support is deferred.
- OQ-031: Which fields define a conversion option?
- OQ-032: How do conversion-rate changes affect historical receipts?
- OQ-033: The owner manages categories/items in version one; their exact semantics remain open.
- OQ-034: Quarry, item, direct cubic-metre quantity, driver, plate, and payment data are confirmed; date/reference and inventory effect remain open.
- OQ-035: Quarry unit is cubic metres; quantity source remains open.
- OQ-036: Paid amount, payment date, remaining balance, and paid/unpaid status are confirmed; allocation rules remain open.
- OQ-037: Closed in Turn 30 — quarry records do not update inventory.
- OQ-038: Multiple dated payments per order are confirmed; allocation of one real-world payment across orders remains open.
- OQ-039: How should quantities with different items or units be summarized?
- OQ-040: Revised in Turn 46 — the owner controls these settings in version one.
- OQ-041: Closed in Turn 33 — one report per project workday.
- OQ-042: Closed in Turn 36 — use worker/driver name, truck plate, and machine name.
- OQ-043: Which work-report fields are required?
- OQ-044: Manager/foreman can create/edit; no approval or lock; view/print/export remain open.
- OQ-045: Balance is deliveries minus machine fills; plant consumption is excluded; labeling/correction remains open.
- OQ-046: What machine and refuelling details are required?
- OQ-047: Is edit history required for daily reports?
- OQ-048: Closed in Turn 41 — manual physical-tank correction is required.
- OQ-049: Which fields and history are retained for fuel corrections?
- OQ-050: Closed in Turn 45 — the sole owner-user chooses dashboard summaries.
- OQ-051: Which filters and periods apply to dashboard summaries?
- OQ-052: Closed in Turn 46 — version one is owner-only; staff accounts are deferred.
- OQ-053: Closed in Turn 48 — support both Android and iPhone.
- OQ-054: Current Xprinter uses 58 mm paper and may be XP-POS-I100; exact model/protocol/printable width remains open.
- OQ-055: How should Bluetooth printing failures be handled?
- OQ-056: Which printer/paper widths must version one support?
- OQ-057: Can the current Xprinter receive Bluetooth jobs from external Android/iPhone devices?
- OQ-058: Closed in Turn 54 — saved receipts can be reopened and reprinted repeatedly.
- OQ-059: Closed in Turn 57 — changes synchronize automatically and appear on another owner device.
- OQ-060: How should synchronization conflicts or failures be handled?
- OQ-061: Closed in Turn 60 — email/password with secure email reset link.
- OQ-062: What backup retention and point-in-time recovery are needed?
- OQ-063: Closed in Turns 60–61 — email reset and persistent offline session.
- OQ-064: Closed as corrected in Turn 64 — local lock excluded; password reset signs out other devices.
- OQ-065: Which reports, filters, columns, and layouts require PDF/Excel export?
- OQ-066: Closed in Turn 71 — retain only corrected values, without change history.
- OQ-067: Closed in Turn 72 — all listed dependent quantities, totals, balances, summaries, and future prints recalculate.
- OQ-068: Closed in Turn 92 — keep recorded payments unchanged, display the excess as an overpaid amount, and do not process refunds.
- OQ-069: Trash retains eligible records until manual permanent deletion; confirmed receipts are excluded; eligible types remain open.
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

## 20. Appendices

No appendices yet.
