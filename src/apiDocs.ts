/**
 * Rentvine API reference, exposed to MCP clients as the `rentvine://api-docs`
 * resource. Extracted from createServer.ts so the tool registry stays readable.
 *
 * This is hand-maintained documentation of Rentvine's manager API, including
 * endpoints this server does not yet wrap.
 */
export const RENTVINE_API_DOCS = `# Rentvine API Reference

## Base URL
\`https://{account}.rentvine.com/api/manager\`

## Authentication
HTTP Basic Auth — Access Key as username, Secret as password.

---

## Object Types
Used with \`objectID\` + \`objectTypeID\` to identify objects sharing a resource (e.g. file attachments).

| ID | Object Type |
|----|-------------|
| 1 | Account |
| 2 | User |
| 3 | Contact |
| 4 | Lease |
| 5 | Bill |
| 6 | Property |
| 7 | Unit |
| 8 | Deposit |
| 9 | Accounting Transaction |
| 10 | Accounting Transaction Entry |
| 11 | Portfolio |
| 12 | Payout |
| 13 | Bank Adjustment |
| 14 | Company |
| 15 | Statement |
| 16 | Work Order |
| 17 | Inspection |
| 18 | Inspection Area |
| 19 | Inspection Item |
| 20 | Application |
| 21 | Applicant |
| 22 | Bank Transfer |
| 23 | Listing |
| 24 | Appliance |
| 25 | Text Message |
| 26 | Email Message |
| 27 | Work Order Estimate |
| 28 | Settlement |
| 29 | Lease Tenant |
| 30 | Email Template |
| 31 | Note |
| 32 | File Attachment |
| 33 | Vendor Bill |
| 34 | Document Transaction |
| 35 | Document Envelope |
| 36 | Application Template |
| 37 | Recurring Bill |
| 38 | Chat Message |
| 39 | Reconciliation |
| 40 | Path |
| 41 | Payout Return |
| 42 | Management Fee Setting |
| 43 | Additional Management Fee Setting |
| 44 | Accounting Setting |
| 45 | Posting Setting |
| 46 | Late Fee Setting |
| 47 | Statement Setting |
| 48 | Payout Batch |
| 49 | Letter |
| 50 | Reminder |
| 51 | Review |

---

## Status & Enum Reference

### Lease Status (primaryLeaseStatusID)
- 1 = Pending
- 2 = Active
- 3 = Closed

### Work Order Status (primaryWorkOrderStatusID)
- 1 = Pending
- 2 = Open
- 3 = Closed
- 4 = On Hold

### Work Order Priority (priorityID)
- 1 = Low
- 2 = Medium
- 3 = High

### Work Order Source (sourceTypeID)
- 1 = Portal
- 2 = In Person
- 3 = Email
- 4 = Text Message
- 5 = Phone
- 6 = Recurring

### Contact Type (contactTypeID)
- 1 = Owner
- 2 = Tenant
- 3 = Vendor
- 4 = Manager
- 5 = Association
- 6 = Applicant

### Ledger Type (ledgerTypeID)
- 1 = Manager
- 2 = Portfolio
- 3 = Property
- 4 = Unit

### Payout Type (payoutTypeID)
- 1 = Check
- 2 = ACH

### Move-Out Status (moveOutStatusID)
- 1 = None
- 2 = Active
- 3 = Completed

---

## Endpoints

### Properties
- \`GET /properties\` — List all properties
- \`POST /properties\` — Create property
- \`GET /properties/{propertyID}\` — View property
- \`POST /properties/{propertyID}\` — Update property
- \`DELETE /properties/{propertyID}\` — Delete property
- \`POST /properties/{propertyID}/deactivate\`
- \`POST /properties/{propertyID}/activate\`
- \`GET /properties/{propertyID}/units\` — List units for a property
- \`GET /properties/{propertyID}/units/{unitID}\` — View unit

### Units (global export)
- \`GET /properties/units/export\` — Export all units (params: isActive, dateTimeModifiedMin/Max, page, pageSize)

### Leases
- \`GET /leases\` — List leases
- \`GET /leases/{leaseID}\` — View lease detail
- \`GET /leases/export\` — Export leases (params: leaseIDs[], primaryLeaseStatusIDs[], page, pageSize)

### Contacts
- \`GET /owners/search\` — List owners
- \`GET /tenants\` — List tenants (confirmed working; returns \`[{ contact: {...} }]\`)
- \`GET /tenants/search\` — List tenants (search variant)
- \`GET /vendors/search\` — List vendors
- \`GET /vendors/{contactID}\` — View vendor detail
- \`GET /associations/search\` — List associations

All contact endpoints share one schema. A tenant record therefore carries
vendor-oriented fields (insurance, discounts, payout/ACH) that are normally
null, alongside genuine PII: \`birthDate\`, \`identificationNumber\`,
\`identificationTypeID\`, and \`achAccountNumberTruncated\`.

### Portfolios
- \`GET /portfolios\` — List portfolios

### Maintenance
- \`GET /maintenance/work-orders\` — List work orders (params: page, pageSize)
- \`POST /maintenance/work-orders\` — Create work order
- \`GET /maintenance/work-orders/{workOrderID}\` — View work order
- \`POST /maintenance/work-orders/{workOrderID}\` — Update work order
- \`GET /maintenance/work-order/statuses\` — List statuses
- \`POST /maintenance/work-order/statuses\` — Create status
- \`GET /maintenance/vendor-trades\` — List vendor trades
- \`POST /maintenance/vendor-trades\` — Create vendor trade
- \`GET /maintenance/inspections\` — List inspections
- \`POST /maintenance/inspections\` — Create inspection
- \`GET /maintenance/inspections/{inspectionID}\` — View inspection

### Accounting
- \`GET /accounting/accounts\` — Chart of accounts
- \`GET /accounting/bills\` — List bills
- \`POST /accounting/bills\` — Create bill
- \`GET /accounting/{billID}\` — View bill
- \`GET /accounting/ledgers\` — List ledgers (required param: search)
- \`GET /accounting/ledgers/search\` — Search ledgers
- \`GET /accounting/transactions/search\` — Search transactions (params: search, isVoided, amountMin/Max, datePostedMin/Max, transactionTypeIDs[], propertyIDs[], primaryLedgerIDs[], page, pageSize)
- \`GET /accounting/transactions/entries/search\` — Search transaction entries

### Accounting Diagnostics
- \`GET /accounting/diagnostics/unused-vendor-credits\`
- \`GET /accounting/diagnostics/negative-bank-accounts\`
- \`GET /accounting/diagnostics/reserve-not-met\`
- \`GET /accounting/diagnostics/escrow-mismatch\`
- \`GET /accounting/diagnostics/prepayment-mismatch\`
- \`GET /accounting/diagnostics/unused-prepayments\`
- \`GET /accounting/diagnostics/bank-account-reconciliation-lapse\`
- \`GET /accounting/diagnostics/vendor-insurance-lapse\`
- \`GET /accounting/diagnostics/credit-debit-mismatch\`
- \`GET /accounting/diagnostics/manager-ledger-balance\`
- \`GET /accounting/diagnostics/suppressed-fee-balance-mismatch\`

### Files
- \`POST /files\` — Upload file and attach to an object
  - Query params: objectID (integer), objectTypeID (integer), includes="attachment"
  - Body: multipart/form-data with file field
  - Response: file object + optional attachment object

### Screening
- \`GET /screening/applications/export\` — Export applications

---

## Work Order Create/Update Fields

### Required for create:
- propertyID, workOrderStatusID, priorityID (1/2/3), isOwnerApproved, isVacant, description, isSharedWithTenant, isSharedWithOwner, sourceTypeID

### Optional:
- unitID, leaseID, vendorContactID, assignedToUserID, requestedByContactID, estimatedAmount, scheduledStartDate, scheduledEndDate, vendorInstructions, vendorTradeID, workOrderProjectID

---

## Bill Create Fields

### Required:
- payeeContactID, billDate (YYYY-MM-DD), dateDue (YYYY-MM-DD), billTypeID, isVoided, isDiscount, isMarkup, managementFeeMode

### Optional:
- reference, paymentMemo, workOrderID, discountPercent, markupPercent, parentBillID, managementFeeBatchID
- charges[]: { ledgerID, chargeAccountID, amount, description }
- leaseCharges[], attachments[]

---

## Pagination
Most list endpoints accept \`page\` (default 1) and \`pageSize\` (default 15 or 25).
`;
