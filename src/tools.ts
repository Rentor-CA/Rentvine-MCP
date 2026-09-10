/**
 * Tool implementations — the translation layer between Rentvine's raw API
 * shapes and the snake_case contract exposed to MCP clients.
 *
 * Each exported function here is wired to a `registerTool` call in
 * createServer.ts. Keep the projection logic in this file; keep HTTP concerns
 * in client.ts.
 */

import * as client from "./client.js";
import type { Row } from "./client.js";

/* ------------------------------------------------------------------ */
/* Enum maps                                                           */
/* ------------------------------------------------------------------ */

/**
 * WARNING: these mappings disagree with the Rentvine API reference embedded in
 * createServer.ts (RENTVINE_API_DOCS), which documents work-order status as
 * 1=Pending, 2=Open, 3=Closed, 4=On Hold and priority as 1=Low, 2=Medium,
 * 3=High (no 4th value). Verify against
 * `GET /maintenance/work-order/statuses` before relying on these.
 */
const LEASE_STATUS: Record<string, string> = {
  "1": "future",
  "2": "active",
  "3": "expired",
  "4": "cancelled",
};

const WO_STATUS: Record<string, string> = {
  "1": "open",
  "2": "in_progress",
  "3": "completed",
  "4": "cancelled",
};

const WO_PRIORITY: Record<string, string> = {
  "1": "low",
  "2": "medium",
  "3": "high",
  "4": "emergency",
};

function invert(map: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, name] of Object.entries(map)) out[name] = id;
  return out;
}

const WO_STATUS_TO_ID = invert(WO_STATUS);
const WO_PRIORITY_TO_ID = invert(WO_PRIORITY);

/** Indexed read that is honest about misses. */
function fromMap(map: Record<string, string>, key: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}

/* ------------------------------------------------------------------ */
/* Shared types                                                        */
/* ------------------------------------------------------------------ */

export type WorkOrderStatus = "open" | "in_progress" | "completed" | "cancelled";
export type WorkOrderPriority = "low" | "medium" | "high" | "emergency";

export interface ErrorResult {
  error: string;
}

export interface CreateWorkOrderInput {
  description: string;
  property_id: string;
  priority: WorkOrderPriority;
  unit_id?: string;
  status?: WorkOrderStatus;
  estimated_amount?: number | string;
  vendor_contact_id?: string;
  is_owner_approved?: boolean;
  scheduled_start?: string;
  scheduled_end?: string;
}

export interface UpdateWorkOrderInput {
  status?: WorkOrderStatus;
  priority?: WorkOrderPriority;
  description?: string;
  estimated_amount?: number | string;
  scheduled_start?: string;
  scheduled_end?: string;
  actual_start?: string;
  actual_end?: string;
  date_closed?: string;
  is_owner_approved?: boolean;
}

export interface VendorsNearInput {
  property_id: string;
  radius_mi?: number;
  active_only?: boolean;
}

export interface CreateBillInput {
  payee_contact_id: number;
  bill_date: string;
  due_date: string;
  bill_type_id: number;
  reference?: string;
  payment_memo?: string;
  work_order_id?: string;
  charges?: Record<string, unknown>[];
}

export interface SearchTransactionsInput {
  search?: string;
  date_min?: string;
  date_max?: string;
  amount_min?: string;
  amount_max?: string;
  is_voided?: boolean;
  page?: number;
  page_size?: number;
}

export interface AttachmentsInput {
  object_id?: number;
  object_type_id?: number;
}

export interface WorkOrderAttachmentsInput {
  work_order_id?: number;
}

export interface FileInput {
  file_id?: number | string;
}

export interface UploadFileInput {
  file_path?: string;
  object_type_id?: number;
  object_id?: number;
  file_name?: string;
  file_content_base64?: string;
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function stripHtml(text: unknown): string {
  return String(text ?? "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function asObj(v: unknown): Row {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {};
}

function s(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

/* ------------------------------------------------------------------ */
/* Properties / units                                                  */
/* ------------------------------------------------------------------ */

export async function listProperties() {
  const rows = await client.fetchProperties();
  return rows.map((row) => {
    const p = asObj(row.property ?? row);
    return {
      property_id: p.propertyID,
      name: p.name,
      address: p.address,
      city: p.city,
      postal_code: p.postalCode,
      type: s(p.isMultiUnit) === "1" ? "multi_family" : "single_family",
      is_active: s(p.isActive) === "1",
      portfolio_id: p.portfolioID,
    };
  });
}

export async function listUnits(propertyName: string) {
  const properties = await client.fetchProperties();
  const needle = propertyName.toLowerCase();
  const match = properties.find((row) => {
    const p = asObj(row.property ?? row);
    const hay = `${s(p.name)} ${s(p.address)}`.toLowerCase();
    return hay.includes(needle);
  });

  if (!match) {
    const names = properties.map((row) => {
      const p = asObj(row.property ?? row);
      return p.name ?? p.address;
    });
    return [
      {
        error: `Property '${propertyName}' not found. Available: ${JSON.stringify(names)}`,
      },
    ];
  }

  const prop = asObj(match.property ?? match);
  const rvId = prop.propertyID;
  if (!rvId) return [{ error: `Property '${propertyName}' has no Rentvine ID.` }];

  const units = await client.fetchUnits(String(rvId));
  return units.map((row) => {
    const u = asObj(row.unit ?? row);
    return {
      unit_id: u.unitID,
      property_id: rvId,
      unit_number: u.number ?? u.unitNumber ?? u.name,
      address: u.address,
      is_active: u.isActive,
      status: u.status ?? (u.isVacant ? "vacant" : "occupied"),
      rent: u.rent ?? u.marketRent,
      deposit: u.deposit,
      beds: u.beds,
      baths: u.fullBaths,
      sqft: u.size,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Leases / applications / inspections                                 */
/* ------------------------------------------------------------------ */

export async function listLeases() {
  const rows = await client.fetchLeases();
  return rows.map((row) => {
    const lse = asObj(row.lease ?? row);
    const unit = asObj(lse.unit ?? row.unit);
    const tenants = lse.tenants;
    const tenantName = Array.isArray(tenants) ? tenants.join(", ") : s(tenants);
    const status = fromMap(LEASE_STATUS, s(lse.primaryLeaseStatusID)) ?? "unknown";
    return {
      lease_id: lse.leaseID,
      tenant_name: tenantName,
      unit_address: unit.address,
      rent_amount: unit.rent,
      deposit: unit.deposit,
      beds: unit.beds,
      baths: unit.fullBaths,
      sqft: unit.size,
      start_date: lse.startDate,
      end_date: lse.endDate,
      move_in_date: lse.moveInDate,
      status,
      notice_date: lse.noticeDate,
      expected_move_out: lse.expectedMoveOutDate,
      is_marked_to_vacate: lse.isMarkedToVacate,
    };
  });
}

export async function listApplications() {
  const rows = await client.fetchApplications();
  return rows.map((a) => {
    const property = asObj(a.property);
    const unit = asObj(a.unit);
    return {
      applicant_name: a.applicantName ?? a.name,
      property_name: a.propertyName ?? property.name,
      unit_number: a.unitNumber ?? unit.number,
      status: a.status,
      applied_at: a.applicationDate ?? a.createdAt,
    };
  });
}

export async function listInspections() {
  const rows = await client.fetchInspections();
  return rows.map((i) => {
    const property = asObj(i.property);
    const unit = asObj(i.unit);
    const inspector = asObj(i.inspector);
    return {
      title: i.title ?? i.type,
      property_name: i.propertyName ?? property.name,
      unit_number: i.unitNumber ?? unit.number,
      scheduled_date: i.scheduledDate ?? i.date,
      status: i.status,
      inspector: i.inspectorName ?? inspector.name,
    };
  });
}

export async function listPortfolios() {
  const rows = await client.fetchPortfolios();
  return rows.map((row) => {
    const p = asObj(row.portfolio ?? row);
    const owners = Array.isArray(p.owners)
      ? p.owners.map((o: unknown) => {
          const oc = asObj(asObj(o).contact ?? o);
          return { contact_id: oc.contactID, name: oc.name };
        })
      : [];
    return {
      portfolio_id: p.portfolioID,
      name: p.name,
      is_active: p.isActive,
      reserve_amount: p.reserveAmount,
      owners,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Work orders                                                         */
/* ------------------------------------------------------------------ */

export async function listWorkOrders() {
  const rows = await client.fetchWorkOrders();
  return rows.map((row) => {
    const wo = asObj(row.workOrder ?? row);
    const vendorContact = asObj(row.contact ?? wo.contact);
    return {
      work_order_id: wo.workOrderID,
      work_order_number: wo.workOrderNumber,
      description: stripHtml(wo.description),
      property_id: wo.propertyID,
      unit_id: wo.unitID,
      status: fromMap(WO_STATUS, s(wo.primaryWorkOrderStatusID)) ?? "unknown",
      priority: fromMap(WO_PRIORITY, s(wo.priorityID)) ?? "unknown",
      estimated_amount: wo.estimatedAmount,
      scheduled_start: wo.scheduledStartDate,
      scheduled_end: wo.scheduledEndDate,
      actual_start: wo.actualStartDate,
      actual_end: wo.actualEndDate,
      vendor: vendorContact.name ?? null,
      is_owner_approved: wo.isOwnerApproved,
      date_closed: wo.dateClosed,
    };
  });
}

export async function createWorkOrder(input: CreateWorkOrderInput) {
  if (!input.description) return { error: "description is required." };
  if (!input.property_id) return { error: "property_id is required." };
  if (!input.priority) return { error: "priority is required." };

  const priorityID = fromMap(WO_PRIORITY_TO_ID, input.priority);
  if (!priorityID) {
    return {
      error: `Invalid priority '${input.priority}'. Expected one of: ${Object.keys(WO_PRIORITY_TO_ID).join(", ")}.`,
    };
  }

  const payload: Row = {
    description: input.description,
    propertyID: input.property_id,
    priorityID,
  };

  if (input.unit_id !== undefined) payload.unitID = input.unit_id;
  if (input.status !== undefined) {
    const statusID = fromMap(WO_STATUS_TO_ID, input.status);
    if (!statusID) {
      return {
        error: `Invalid status '${input.status}'. Expected one of: ${Object.keys(WO_STATUS_TO_ID).join(", ")}.`,
      };
    }
    payload.primaryWorkOrderStatusID = statusID;
  }
  if (input.estimated_amount !== undefined)
    payload.estimatedAmount = String(input.estimated_amount);
  if (input.vendor_contact_id !== undefined)
    payload.vendorContactID = input.vendor_contact_id;
  if (input.is_owner_approved !== undefined) {
    payload.isOwnerApproved = input.is_owner_approved ? "1" : "0";
  }
  if (input.scheduled_start !== undefined)
    payload.scheduledStartDate = input.scheduled_start;
  if (input.scheduled_end !== undefined)
    payload.scheduledEndDate = input.scheduled_end;

  const response = await client.createWorkOrder(payload);
  const created = asObj(asObj(response).workOrder ?? response);

  return {
    work_order_id: created.workOrderID,
    work_order_number: created.workOrderNumber,
    property_id: created.propertyID,
    unit_id: created.unitID,
    status: fromMap(WO_STATUS, s(created.primaryWorkOrderStatusID)) ?? "unknown",
    priority: fromMap(WO_PRIORITY, s(created.priorityID)) ?? "unknown",
    estimated_amount: created.estimatedAmount,
    description: stripHtml(created.description),
    sent_payload: payload,
  };
}

export async function updateWorkOrder(
  workOrderId: string,
  input: UpdateWorkOrderInput,
) {
  if (!workOrderId) {
    return { error: "work_order_id is required." };
  }

  const payload: Row = {};

  if (input.status !== undefined) {
    const id = fromMap(WO_STATUS_TO_ID, input.status);
    if (!id) {
      return {
        error: `Invalid status '${input.status}'. Expected one of: ${Object.keys(WO_STATUS_TO_ID).join(", ")}.`,
      };
    }
    payload.primaryWorkOrderStatusID = id;
    // Auto-stamp dateClosed when caller marks completed/cancelled and didn't
    // supply one explicitly — matches how Rentvine's UI behaves.
    if (
      (input.status === "completed" || input.status === "cancelled") &&
      input.date_closed === undefined
    ) {
      payload.dateClosed = new Date().toISOString().slice(0, 10);
    }
  }

  if (input.priority !== undefined) {
    const id = fromMap(WO_PRIORITY_TO_ID, input.priority);
    if (!id) {
      return {
        error: `Invalid priority '${input.priority}'. Expected one of: ${Object.keys(WO_PRIORITY_TO_ID).join(", ")}.`,
      };
    }
    payload.priorityID = id;
  }

  if (input.description !== undefined) payload.description = input.description;
  if (input.estimated_amount !== undefined)
    payload.estimatedAmount = String(input.estimated_amount);
  if (input.scheduled_start !== undefined)
    payload.scheduledStartDate = input.scheduled_start;
  if (input.scheduled_end !== undefined)
    payload.scheduledEndDate = input.scheduled_end;
  if (input.actual_start !== undefined)
    payload.actualStartDate = input.actual_start;
  if (input.actual_end !== undefined) payload.actualEndDate = input.actual_end;
  if (input.date_closed !== undefined) payload.dateClosed = input.date_closed;
  if (input.is_owner_approved !== undefined) {
    payload.isOwnerApproved = input.is_owner_approved ? "1" : "0";
  }

  if (Object.keys(payload).length === 0) {
    return { error: "No fields provided to update." };
  }

  const response = await client.updateWorkOrder(workOrderId, payload);
  return {
    work_order_id: workOrderId,
    updated_fields: payload,
    response,
  };
}

/* ------------------------------------------------------------------ */
/* Contacts                                                            */
/* ------------------------------------------------------------------ */

export async function getTenantBalance(tenantName: string) {
  const tenants = await client.fetchTenants();
  const needle = tenantName.toLowerCase();
  const match = tenants.find((row) => {
    const t = asObj(row.contact ?? row);
    return s(t.name).toLowerCase().includes(needle);
  });

  if (!match) return { error: `Tenant '${tenantName}' not found in Rentvine.` };

  const contact = asObj(match.contact ?? match);
  const rvId = contact.contactID ?? contact.tenantID ?? contact.id;
  if (!rvId) return { error: `Tenant '${tenantName}' has no Rentvine ID.` };

  const data = await client.fetchTenantBalance(String(rvId));
  return { tenant_name: tenantName, ledger: data };
}

export interface ListTenantsInput {
  search?: string;
  active_only?: boolean;
  include_sensitive?: boolean;
  page?: number;
  page_size?: number;
}

/**
 * Identity, contact, and status fields — the working set for tenant workflows.
 *
 * Tenants share Rentvine's contact schema with vendors and owners, so the raw
 * record also carries government-ID, payout/ACH, and vendor-billing fields.
 * Those are gated behind `include_sensitive` rather than returned by default:
 * a bare list_tenants call would otherwise put every tenant's date of birth and
 * bank details into the model's context.
 */
function projectTenant(c: Row) {
  const code = c.code ?? null;
  return {
    contact_id: c.contactID,
    contact_type_id: c.contactTypeID,
    contact_type: c.contactType,
    vendor_type_id: c.vendorTypeID,
    code,
    code_metadata: parseCodeMetadata(code),
    name: c.name,
    first_name: c.firstName,
    middle_name: c.middleName,
    last_name: c.lastName,
    suffix: c.suffix,
    email: c.email,
    phone: c.phone,
    address: c.address,
    address2: c.address2,
    city: c.city,
    state: c.stateID,
    postal_code: c.postalCode,
    country: c.countryID,
    is_active: s(c.isActive) === "1",
    applicant_id: c.applicantID,
    website_url: c.websiteUrl,
    owner_portal_name_override: c.ownerPortalNameOverride,
    is_from_import: c.isFromImport,
    import_source_key: c.importSourceKey,
    date_time_created: c.dateTimeCreated,
    date_time_modified: c.dateTimeModified,
    date_time_deactivated: c.dateTimeDeactivated,
  };
}

/** Everything else the endpoint returns: PII, financial identity, billing config. */
function projectTenantSensitive(c: Row) {
  return {
    // Personal / government identity
    birth_date: c.birthDate,
    identification_type_id: c.identificationTypeID,
    identification_number: c.identificationNumber,
    identification_country_id: c.identificationCountryID,
    identification_issuing_location: c.identificationIssuingLocation,
    identification_expiration_date: c.identificationExpirationDate,
    // Tax / payee
    tax_payer_name: c.taxPayerName,
    tax_form_type_id: c.taxFormTypeID,
    payee_name: c.payeeName,
    has_tax_identifier: c.hasTaxIdentifier,
    // Payout / banking
    payout_type_id: c.payoutTypeID,
    other_payout_type_id: c.otherPayoutTypeID,
    ach_details_ciphertext_id: c.achDetailsCiphertextID,
    ach_account_number_truncated: c.achAccountNumberTruncated,
    ach_account_type_id: c.achAccountTypeID,
    ach_is_corporate_account: c.achIsCorporateAccount,
    hold_payments: c.holdPayments,
    default_bill_charge_account_id: c.defaultBillChargeAccountID,
    // Shared contact-schema billing config (normally null on tenants)
    max_line_items_on_payment: c.maxLineItemsOnPayment,
    prevent_consolidated_payments: c.preventConsolidatedPayments,
    is_bill_approval_exempt: c.isBillApprovalExempt,
    is_billing_sales_tax_enabled: c.isBillingSalesTaxEnabled,
    invoice_autofill_template_id: c.invoiceAutofillTemplateID,
    is_quickbooks_export_enabled: c.isQuickbooksExportEnabled,
    quickbooks_customer_name: c.quickbooksCustomerName,
    discount_percent: c.discountPercent,
    discount_amount: c.discountAmount,
    discount_amount_min: c.discountAmountMin,
    discount_amount_max: c.discountAmountMax,
    discount_grace_days: c.discountGraceDays,
    is_insurance_required_for_payment: c.isInsuranceRequiredForPayment,
    liability_insurance_name: c.liabilityInsuranceName,
    liability_insurance_policy_number: c.liabilityInsurancePolicyNumber,
    liability_insurance_expiration: c.liabilityInsuranceExpiresDate,
    workers_comp_insurance_name: c.workersCompInsuranceName,
    workers_comp_insurance_policy_number: c.workersCompInsurancePolicyNumber,
    workers_comp_insurance_expiration: c.workersCompInsuranceExpiresDate,
  };
}

export async function listTenants(input: ListTenantsInput = {}) {
  const params: Record<string, string> = {};
  if (input.page !== undefined) params.page = String(input.page);
  if (input.page_size !== undefined) params.pageSize = String(input.page_size);

  const rows = await client.fetchTenants(
    Object.keys(params).length ? params : undefined,
  );

  let contacts = rows.map((row) => asObj(row.contact ?? row));

  if (input.active_only) {
    contacts = contacts.filter((c) => s(c.isActive) === "1");
  }

  if (input.search) {
    // Filtered client-side — /tenants exposes no documented search param.
    const needle = input.search.toLowerCase();
    contacts = contacts.filter((c) =>
      `${s(c.name)} ${s(c.email)} ${s(c.phone)}`.toLowerCase().includes(needle),
    );
  }

  return contacts.map((c) =>
    input.include_sensitive
      ? { ...projectTenant(c), ...projectTenantSensitive(c) }
      : projectTenant(c),
  );
}

export async function listOwners() {
  const rows = await client.fetchOwners();
  return rows.map((row) => {
    const c = asObj(row.contact ?? row);
    return {
      contact_id: c.contactID,
      name: c.name,
      email: c.email,
      phone: c.phone,
      address: c.address,
      city: c.city,
      state: c.state,
      postal_code: c.postalCode,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Vendors                                                             */
/* ------------------------------------------------------------------ */

/**
 * Map a raw Rentvine vendor contact record into a snake_case object that
 * surfaces every field the /vendors/search endpoint returns. Kept as a helper
 * so vendorsNear can reuse the same projection.
 */
function projectVendor(c: Row) {
  return {
    contact_id: c.contactID,
    contact_type_id: c.contactTypeID,
    vendor_type_id: c.vendorTypeID,
    name: c.name,
    email: c.email,
    phone: c.phone,
    address: c.address,
    address2: c.address2,
    city: c.city,
    state: c.stateID,
    postal_code: c.postalCode,
    country: c.countryID,
    birth_date: c.birthDate,
    // Billing / payout
    default_bill_charge_account_id: c.defaultBillChargeAccountID,
    payee_name: c.payeeName,
    tax_payer_name: c.taxPayerName,
    tax_form_type_id: c.taxFormTypeID,
    payout_type_id: c.payoutTypeID,
    ach_details_ciphertext_id: c.achDetailsCiphertextID,
    ach_account_number_truncated: c.achAccountNumberTruncated,
    ach_account_type_id: c.achAccountTypeID,
    hold_payments: c.holdPayments,
    is_billing_sales_tax_enabled: c.isBillingSalesTaxEnabled,
    invoice_autofill_template_id: c.invoiceAutofillTemplateID,
    // Liability insurance
    liability_insurance_name: c.liabilityInsuranceName,
    liability_insurance_policy_number: c.liabilityInsurancePolicyNumber,
    liability_insurance_expiration: c.liabilityInsuranceExpiresDate,
    days_until_liability_insurance_expires:
      c.daysUntilLiabilityInsuranceExpires,
    // Workers comp
    workers_comp_insurance_name: c.workersCompInsuranceName,
    workers_comp_insurance_policy_number: c.workersCompInsurancePolicyNumber,
    workers_comp_insurance_expiration: c.workersCompInsuranceExpiresDate,
    days_until_workers_comp_insurance_expires:
      c.daysUntilWorkersCompInsuranceExpires,
    // Combined insurance
    insurance_expiration: c.insuranceExpiresDate,
    days_until_insurance_expires: c.daysUntilInsuranceExpires,
    is_insurance_required_for_payment: c.isInsuranceRequiredForPayment,
    // Discounts
    discount_percent: c.discountPercent,
    discount_grace_days: c.discountGraceDays,
    // ID docs
    identification_type_id: c.identificationTypeID,
    identification_number: c.identificationNumber,
    identification_issuing_location: c.identificationIssuingLocation,
    identification_expiration_date: c.identificationExpirationDate,
    identification_country_id: c.identificationCountryID,
    has_tax_identifier: c.hasTaxIdentifier,
    // Status / audit
    is_active: c.isActive,
    date_time_created: c.dateTimeCreated,
    date_time_modified: c.dateTimeModified,
    date_time_deactivated: c.dateTimeDeactivated,
    // Stats
    property_count: c.propertyCount,
  };
}

export async function listVendors() {
  const rows = await client.fetchVendors();
  return rows.map((row) => projectVendor(asObj(row.contact ?? row)));
}

/**
 * Parse the packed `code` field into a metadata object using the
 * pipe-delimited k=v convention our FL import script uses
 * (id=, t=, hr=, eh=, min=, tr=, r=, em=, pr=, p=).
 */
function parseCodeMetadata(code: unknown): Record<string, string> | null {
  const raw = code == null ? "" : String(code);
  if (!raw || !raw.includes("=")) return null;
  const out: Record<string, string> = {};
  for (const part of raw.split("|")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    out[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Detail projection — superset of projectVendor with the ~20 extra fields that
 * only appear on /vendors/{id} (not /vendors/search).
 */
function projectVendorDetail(c: Row) {
  const base = projectVendor(c);
  const code = c.code ?? null;
  return {
    ...base,
    // Detail-endpoint-only identity fields
    code,
    code_metadata: parseCodeMetadata(code),
    first_name: c.firstName,
    middle_name: c.middleName,
    last_name: c.lastName,
    suffix: c.suffix,
    // Detail-only billing / payout
    other_payout_type_id: c.otherPayoutTypeID,
    ach_is_corporate_account: c.achIsCorporateAccount,
    // Detail-only discount tiers
    discount_amount: c.discountAmount,
    discount_amount_min: c.discountAmountMin,
    discount_amount_max: c.discountAmountMax,
    // Detail-only flags
    max_line_items_on_payment: c.maxLineItemsOnPayment,
    prevent_consolidated_payments: c.preventConsolidatedPayments,
    is_from_import: c.isFromImport,
    import_source_key: c.importSourceKey,
    website_url: c.websiteUrl,
    applicant_id: c.applicantID,
    owner_portal_name_override: c.ownerPortalNameOverride,
    is_bill_approval_exempt: c.isBillApprovalExempt,
    // QuickBooks linkage
    is_quickbooks_export_enabled: c.isQuickbooksExportEnabled,
    quickbooks_customer_name: c.quickbooksCustomerName,
    // Contact type label (only on detail response)
    contact_type: c.contactType,
  };
}

export async function getVendor(vendorId: string) {
  if (!vendorId) return { error: "vendor_id is required." };
  const response = await client.fetchVendor(vendorId);
  const contact = asObj(asObj(response).contact ?? response);
  if (!contact.contactID) {
    return { error: `Vendor ${vendorId} not found.` };
  }
  return projectVendorDetail(contact);
}

/** Haversine distance in miles between two lat/lon points. */
function haversineMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 3958.7613; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export async function vendorsNear(input: VendorsNearInput) {
  if (!input.property_id) return { error: "property_id is required." };

  const radiusMi = input.radius_mi ?? 25;
  const activeOnly = input.active_only ?? true;

  const propertyResponse = await client.fetchProperty(input.property_id);
  const property = asObj(asObj(propertyResponse).property ?? propertyResponse);
  const pLat = Number(property.latitude);
  const pLon = Number(property.longitude);
  if (!Number.isFinite(pLat) || !Number.isFinite(pLon)) {
    return {
      error: `Property ${input.property_id} has no geocoded latitude/longitude in Rentvine. Cannot compute vendor distances.`,
    };
  }

  const { default: zipcodes } = await import("zipcodes");
  const rows = await client.fetchVendors();
  const vendors = rows.map((row) => asObj(row.contact ?? row));

  const matched: Array<ReturnType<typeof projectVendor> & {
    distance_miles: number;
    vendor_latitude: number;
    vendor_longitude: number;
    vendor_zip_resolved: string;
  }> = [];
  const skipped: Array<{ name: string; reason: string }> = [];

  for (const c of vendors) {
    if (activeOnly && s(c.isActive) !== "1") continue;

    const zip = s(c.postalCode).slice(0, 5);
    if (!zip) {
      skipped.push({ name: s(c.name), reason: "missing postal_code" });
      continue;
    }

    const zipInfo = zipcodes.lookup(zip);
    if (!zipInfo || typeof zipInfo.latitude !== "number") {
      skipped.push({ name: s(c.name), reason: `zip ${zip} not in lookup table` });
      continue;
    }

    const dist = haversineMiles(pLat, pLon, zipInfo.latitude, zipInfo.longitude);
    if (dist > radiusMi) continue;

    matched.push({
      ...projectVendor(c),
      distance_miles: Math.round(dist * 10) / 10,
      vendor_latitude: zipInfo.latitude,
      vendor_longitude: zipInfo.longitude,
      vendor_zip_resolved: zip,
    });
  }

  matched.sort((a, b) => a.distance_miles - b.distance_miles);

  return {
    property_id: input.property_id,
    property_address: property.address,
    property_city: property.city,
    property_state: property.stateID,
    property_postal_code: property.postalCode,
    property_latitude: pLat,
    property_longitude: pLon,
    radius_mi: radiusMi,
    active_only: activeOnly,
    match_count: matched.length,
    vendors: matched,
    skipped,
    note: "Vendor locations are approximated from ZIP-code centroids (offline lookup). Rentvine does not store per-vendor lat/lon. Use this as a coarse geographic filter, not a precise distance.",
  };
}

/* ------------------------------------------------------------------ */
/* Accounting                                                          */
/* ------------------------------------------------------------------ */

export async function listBills() {
  const rows = await client.fetchBills();
  return rows.map((row) => {
    const b = asObj(row.bill ?? row);
    return {
      bill_id: b.billID,
      bill_type_id: b.billTypeID,
      payee_contact_id: b.payeeContactID,
      bill_date: b.billDate,
      date_due: b.dateDue,
      is_voided: b.isVoided,
      reference: b.reference,
      payment_memo: b.paymentMemo,
      work_order_id: b.workOrderID,
    };
  });
}

export async function createBill(input: CreateBillInput) {
  const payload: Row = {
    payeeContactID: input.payee_contact_id,
    billDate: input.bill_date,
    dateDue: input.due_date,
    billTypeID: input.bill_type_id,
    isVoided: false,
    isDiscount: false,
    isMarkup: false,
    managementFeeMode: 0,
  };

  if (input.reference !== undefined) payload.reference = input.reference;
  if (input.payment_memo !== undefined) payload.paymentMemo = input.payment_memo;
  if (input.work_order_id !== undefined) payload.workOrderID = input.work_order_id;
  if (input.charges !== undefined) payload.charges = input.charges;

  const response = await client.createBill(payload);
  const b = asObj(asObj(response).bill ?? response);
  return {
    bill_id: b.billID,
    payee_contact_id: b.payeeContactID,
    bill_date: b.billDate,
    date_due: b.dateDue,
    reference: b.reference,
  };
}

export async function searchTransactions(input: SearchTransactionsInput) {
  const params: Record<string, string> = {};
  if (input.search) params.search = input.search;
  if (input.date_min) params.datePostedMin = input.date_min;
  if (input.date_max) params.datePostedMax = input.date_max;
  if (input.amount_min !== undefined) params.amountMin = input.amount_min;
  if (input.amount_max !== undefined) params.amountMax = input.amount_max;
  if (input.is_voided !== undefined) params.isVoided = String(input.is_voided);
  if (input.page !== undefined) params.page = String(input.page);
  if (input.page_size !== undefined) params.pageSize = String(input.page_size);

  const data = await client.searchTransactions(params);
  const rows: Row[] = Array.isArray(data)
    ? (data as Row[])
    : ((asObj(data).data as Row[] | undefined) ?? []);

  return rows.map((row) => {
    const t = asObj(row.transaction ?? row);
    const ledger = asObj(row.ledger ?? {});
    const property = asObj(row.property ?? {});
    return {
      transaction_id: t.transactionID,
      type: t.type,
      amount: t.amount,
      description: t.description,
      reference: t.reference,
      date_posted: t.datePosted,
      is_voided: t.isVoided,
      ledger_name: ledger.name,
      property_name: property.name,
    };
  });
}

export async function listAccounts() {
  const rows = await client.fetchAccounts();
  return rows.map((row) => {
    const a = asObj(row.account ?? row);
    const cat = asObj(row.accountCategory ?? {});
    return {
      account_id: a.accountID,
      number: a.number,
      name: a.name,
      is_active: a.isActive,
      category: cat.name,
      account_type_id: a.accountTypeID,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Files / attachments                                                 */
/* ------------------------------------------------------------------ */

function mapAttachmentRow(row: unknown) {
  const r = asObj(row);
  const file = asObj(r.file ?? r);
  const attachment = asObj(r.attachment ?? {});
  return {
    file_id: file.fileID,
    file_name: file.fileName,
    file_size: file.fileSize,
    file_type: file.fileType,
    mime_type: file.mimeType ?? file.contentType,
    uploaded_at: file.dateCreated ?? file.createdAt,
    object_id: attachment.objectID ?? r.objectID,
    object_type_id: attachment.objectTypeID ?? r.objectTypeID,
    attachment_id: attachment.fileAttachmentID ?? null,
    url: file.url ?? file.downloadURL ?? null,
  };
}

export async function listAttachments(input: AttachmentsInput) {
  if (input.object_id === undefined || input.object_type_id === undefined) {
    return {
      error:
        "object_id and object_type_id are required. Use list_object_types for valid object_type_id values (e.g. 16 = Work Order).",
    };
  }
  const rows = await client.fetchFiles(input.object_id, input.object_type_id);
  return rows.map(mapAttachmentRow);
}

export async function listWorkOrderAttachments(
  input: WorkOrderAttachmentsInput,
) {
  if (!input.work_order_id) return { error: "work_order_id is required." };
  const rows = await client.fetchFiles(input.work_order_id, 16);
  return rows.map(mapAttachmentRow);
}

export async function getFile(input: FileInput) {
  if (!input.file_id) return { error: "file_id is required." };
  const response = await client.fetchFile(input.file_id);
  const raw = Array.isArray(response)
    ? (response[0] ?? {})
    : (asObj(response).data ?? response);
  return mapAttachmentRow(asObj(raw));
}

export async function downloadFile(input: FileInput) {
  if (!input.file_id) return { error: "file_id is required." };

  const { contentType, buffer } = await client.downloadFileBinary(input.file_id);

  const MAX_BYTES = 1_000_000; // ~1MB raw
  if (buffer.length > MAX_BYTES) {
    return {
      error: `File is ~${Math.round(buffer.length / 1024)}KB — too large to return as base64 (limit ~1MB). Use the url field from get_file to access it directly, or ask Rentvine support for a direct download link.`,
      mime_type: contentType,
      size_bytes: buffer.length,
    };
  }

  const isImage = contentType.startsWith("image/");
  return {
    file_id: input.file_id,
    mime_type: contentType,
    size_bytes: buffer.length,
    is_image: isImage,
    content_base64: buffer.toString("base64"),
  };
}

export async function uploadFile(input: UploadFileInput) {
  let buffer: Buffer;
  let fileName: string;

  if (input.file_path) {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    buffer = Buffer.from(await fs.readFile(input.file_path));
    fileName = input.file_name ?? path.basename(input.file_path);
  } else if (input.file_content_base64 && input.file_name) {
    const BASE64_LIMIT = 2_666_667; // ~2MB raw (base64 inflates by ~33%)
    if (input.file_content_base64.length > BASE64_LIMIT) {
      const rawKB = Math.round((input.file_content_base64.length * 0.75) / 1024);
      throw new Error(
        `File is ~${rawKB}KB — too large to pass as base64 (limit ~2MB raw). ` +
          `Use file_path instead: upload_file(file_path="/absolute/path/to/file", ...)`,
      );
    }
    buffer = Buffer.from(input.file_content_base64, "base64");
    fileName = input.file_name;
  } else {
    throw new Error(
      "Provide either file_path or both file_content_base64 and file_name.",
    );
  }

  const response = await client.uploadFile(
    buffer,
    fileName,
    input.object_id,
    input.object_type_id,
  );
  const r = asObj(response);
  const file = asObj(r.file ?? r);
  const attachment = asObj(r.attachment ?? {});
  return {
    file_id: file.fileID,
    file_name: file.fileName,
    file_size: file.fileSize,
    file_type: file.fileType,
    attachment_id: attachment.fileAttachmentID ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Static reference                                                    */
/* ------------------------------------------------------------------ */

export interface ObjectType {
  object_type_id: number;
  name: string;
}

export const OBJECT_TYPES: readonly ObjectType[] = [
  { object_type_id: 1, name: "Account" },
  { object_type_id: 2, name: "User" },
  { object_type_id: 3, name: "Contact" },
  { object_type_id: 4, name: "Lease" },
  { object_type_id: 5, name: "Bill" },
  { object_type_id: 6, name: "Property" },
  { object_type_id: 7, name: "Unit" },
  { object_type_id: 8, name: "Deposit" },
  { object_type_id: 9, name: "Accounting Transaction" },
  { object_type_id: 10, name: "Accounting Transaction Entry" },
  { object_type_id: 11, name: "Portfolio" },
  { object_type_id: 12, name: "Payout" },
  { object_type_id: 13, name: "Bank Adjustment" },
  { object_type_id: 14, name: "Company" },
  { object_type_id: 15, name: "Statement" },
  { object_type_id: 16, name: "Work Order" },
  { object_type_id: 17, name: "Inspection" },
  { object_type_id: 18, name: "Inspection Area" },
  { object_type_id: 19, name: "Inspection Item" },
  { object_type_id: 20, name: "Application" },
  { object_type_id: 21, name: "Applicant" },
  { object_type_id: 22, name: "Bank Transfer" },
  { object_type_id: 23, name: "Listing" },
  { object_type_id: 24, name: "Appliance" },
  { object_type_id: 25, name: "Text Message" },
  { object_type_id: 26, name: "Email Message" },
  { object_type_id: 27, name: "Work Order Estimate" },
  { object_type_id: 28, name: "Settlement" },
  { object_type_id: 29, name: "Lease Tenant" },
  { object_type_id: 30, name: "Email Template" },
  { object_type_id: 31, name: "Note" },
  { object_type_id: 32, name: "File Attachment" },
  { object_type_id: 33, name: "Vendor Bill" },
  { object_type_id: 34, name: "Document Transaction" },
  { object_type_id: 35, name: "Document Envelope" },
  { object_type_id: 36, name: "Application Template" },
  { object_type_id: 37, name: "Recurring Bill" },
  { object_type_id: 38, name: "Chat Message" },
  { object_type_id: 39, name: "Reconciliation" },
  { object_type_id: 40, name: "Path" },
  { object_type_id: 41, name: "Payout Return" },
  { object_type_id: 42, name: "Management Fee Setting" },
  { object_type_id: 43, name: "Additional Management Fee Setting" },
  { object_type_id: 44, name: "Accounting Setting" },
  { object_type_id: 45, name: "Posting Setting" },
  { object_type_id: 46, name: "Late Fee Setting" },
  { object_type_id: 47, name: "Statement Setting" },
  { object_type_id: 48, name: "Payout Batch" },
  { object_type_id: 49, name: "Letter" },
  { object_type_id: 50, name: "Reminder" },
  { object_type_id: 51, name: "Review" },
];

export async function listObjectTypes(): Promise<readonly ObjectType[]> {
  return OBJECT_TYPES;
}
