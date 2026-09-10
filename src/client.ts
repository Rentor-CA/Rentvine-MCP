/**
 * Thin HTTP layer over the Rentvine manager API.
 *
 * Everything here speaks Rentvine's native shapes (camelCase, string-encoded
 * booleans, inconsistent envelopes). Translation into our snake_case tool
 * contract happens one layer up, in tools.ts.
 */

/** A raw Rentvine record. Fields are `unknown` because the API is untyped. */
export type Row = Record<string, unknown>;

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface ClientArgs {
  baseUrl: string;
  headers: Record<string, string>;
}

export interface RequestOptions {
  params?: Record<string, string>;
  body?: unknown;
}

export interface BinaryResponse {
  contentType: string;
  buffer: Buffer;
}

const REQUEST_TIMEOUT_MS = 30_000;
const BINARY_TIMEOUT_MS = 60_000;

function getClientArgs(): ClientArgs {
  const apiKey = process.env.RENTVINE_API_KEY ?? "";
  const apiSecret = process.env.RENTVINE_API_SECRET ?? "";
  const company = process.env.RENTVINE_COMPANY ?? "";
  if (!apiKey || !apiSecret || !company) {
    throw new Error(
      "Rentvine credentials incomplete. Set RENTVINE_API_KEY, RENTVINE_API_SECRET, and RENTVINE_COMPANY.",
    );
  }
  const baseUrl = `https://${company}.rentvine.com/api/manager`;
  const token = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");
  const headers = {
    Authorization: `Basic ${token}`,
    Accept: "application/json",
  };
  return { baseUrl, headers };
}

/**
 * Rentvine wraps list results inconsistently — sometimes a bare array,
 * sometimes `{ data: [...] }`, sometimes `{ results: [...] }`. Normalize.
 *
 * NOTE: returns [] for any unrecognized shape, which means an API contract
 * change reads as "no results" rather than surfacing an error.
 */
function unwrap(data: unknown): Row[] {
  if (Array.isArray(data)) return data as Row[];
  if (data && typeof data === "object") {
    const obj = data as Row;
    const inner = obj.data ?? obj.results;
    if (Array.isArray(inner)) return inner as Row[];
  }
  return [];
}

async function request(
  method: HttpMethod,
  path: string,
  opts: RequestOptions = {},
): Promise<unknown> {
  const { baseUrl, headers } = getClientArgs();
  const url = new URL(`${baseUrl}${path}`);
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) url.searchParams.set(k, v);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const init: RequestInit = {
    method,
    headers: {
      ...headers,
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    signal: controller.signal,
  };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);

  try {
    const resp = await fetch(url, init);
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(
        `Rentvine ${resp.status} ${resp.statusText}: ${body.slice(0, 200)}`,
      );
    }
    const text = await resp.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function get(
  path: string,
  params?: Record<string, string>,
): Promise<unknown> {
  return request("GET", path, { params });
}

/* ------------------------------------------------------------------ */
/* Properties / units                                                  */
/* ------------------------------------------------------------------ */

export async function fetchProperties(): Promise<Row[]> {
  return unwrap(await get("/properties"));
}

export async function fetchProperty(propertyId: string): Promise<unknown> {
  return await get(`/properties/${propertyId}`);
}

export async function fetchUnits(propertyRentvineId: string): Promise<Row[]> {
  return unwrap(await get(`/properties/${propertyRentvineId}/units`));
}

/* ------------------------------------------------------------------ */
/* Contacts                                                            */
/* ------------------------------------------------------------------ */

/**
 * GET /tenants — returns `[{ contact: {...} }]` using the same shared contact
 * schema as /vendors/search and /owners/search.
 *
 * Note this is `/tenants`, not the `/tenants/search` listed in apiDocs.ts;
 * `/tenants` is the endpoint confirmed to return data on our account.
 *
 * `params` is passed through to the query string. Rentvine's documented
 * `page`/`pageSize` are accepted here, but this endpoint's paging behavior is
 * unverified — if it ignores them you get its default page size.
 */
export async function fetchTenants(
  params?: Record<string, string>,
): Promise<Row[]> {
  return unwrap(await get("/tenants", params));
}

export async function fetchOwners(): Promise<Row[]> {
  return unwrap(await get("/owners/search"));
}

export async function fetchVendors(): Promise<Row[]> {
  return unwrap(await get("/vendors/search"));
}

export async function fetchVendor(vendorId: string): Promise<unknown> {
  return await get(`/vendors/${vendorId}`);
}

/* ------------------------------------------------------------------ */
/* Leases / applications / inspections                                 */
/* ------------------------------------------------------------------ */

export async function fetchLeases(): Promise<Row[]> {
  return unwrap(await get("/leases"));
}

export async function fetchApplications(): Promise<Row[]> {
  return unwrap(await get("/applications"));
}

export async function fetchInspections(): Promise<Row[]> {
  return unwrap(await get("/maintenance/inspections"));
}

export async function fetchPortfolios(): Promise<Row[]> {
  return unwrap(await get("/portfolios"));
}

/* ------------------------------------------------------------------ */
/* Work orders                                                         */
/* ------------------------------------------------------------------ */

export async function fetchWorkOrders(): Promise<Row[]> {
  return unwrap(await get("/maintenance/work-orders"));
}

export async function createWorkOrder(body: Row): Promise<unknown> {
  // Create contract mirrors update: POST to the collection path, bare body
  // (no { workOrder: {...} } envelope). Minimal required fields are
  // description, propertyID, and priorityID — Rentvine auto-fills unitID
  // from the property and defaults primaryWorkOrderStatusID to 1 (open).
  return await request("POST", "/maintenance/work-orders", { body });
}

export async function updateWorkOrder(
  workOrderId: string,
  updates: Row,
): Promise<unknown> {
  // Rentvine's update contract is POST (not PUT/PATCH) to the singular
  // resource path, with a *bare* body — no { workOrder: {...} } envelope, even
  // though reads return one. Envelope POSTs return 200 but silently no-op.
  // Partial bodies are honored; only send the fields you want to change.
  return await request("POST", `/maintenance/work-orders/${workOrderId}`, {
    body: updates,
  });
}

/* ------------------------------------------------------------------ */
/* Accounting                                                          */
/* ------------------------------------------------------------------ */

export async function fetchTenantBalance(
  tenantRentvineId: string,
): Promise<unknown> {
  return await get("/accounting/ledgers/search", { tenantId: tenantRentvineId });
}

export async function fetchBills(): Promise<Row[]> {
  return unwrap(await get("/accounting/bills"));
}

export async function createBill(body: Row): Promise<unknown> {
  return await request("POST", "/accounting/bills", { body });
}

export async function searchTransactions(
  params: Record<string, string>,
): Promise<unknown> {
  return await get("/accounting/transactions/search", params);
}

export async function fetchAccounts(): Promise<Row[]> {
  return unwrap(await get("/accounting/accounts"));
}

/* ------------------------------------------------------------------ */
/* Files                                                               */
/* ------------------------------------------------------------------ */

export async function fetchObjectTypes(): Promise<Row[]> {
  return unwrap(await get("/object-types"));
}

export async function fetchFiles(
  objectId?: number,
  objectTypeId?: number,
): Promise<Row[]> {
  const params: Record<string, string> = { includes: "attachment" };
  if (objectId !== undefined) params.objectID = String(objectId);
  if (objectTypeId !== undefined) params.objectTypeID = String(objectTypeId);
  return unwrap(await get("/files", params));
}

export async function fetchFile(fileId: number | string): Promise<unknown> {
  return await get(`/files/${fileId}`, { includes: "attachment" });
}

export async function downloadFileBinary(
  fileId: number | string,
): Promise<BinaryResponse> {
  const { baseUrl, headers } = getClientArgs();
  const url = new URL(`${baseUrl}/files/${fileId}/download`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BINARY_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { Authorization: headers.Authorization },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(
        `Rentvine ${resp.status} ${resp.statusText}: ${body.slice(0, 200)}`,
      );
    }
    const contentType =
      resp.headers.get("content-type") ?? "application/octet-stream";
    const arrayBuffer = await resp.arrayBuffer();
    return { contentType, buffer: Buffer.from(arrayBuffer) };
  } finally {
    clearTimeout(timeout);
  }
}

export async function uploadFile(
  fileContent: Buffer,
  fileName: string,
  objectId?: number,
  objectTypeId?: number,
): Promise<unknown> {
  const { baseUrl, headers } = getClientArgs();
  const url = new URL(`${baseUrl}/files`);
  if (objectId !== undefined) url.searchParams.set("objectID", String(objectId));
  if (objectTypeId !== undefined)
    url.searchParams.set("objectTypeID", String(objectTypeId));
  url.searchParams.set("includes", "attachment");

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(fileContent)]), fileName);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BINARY_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: headers.Authorization },
      body: form,
      signal: controller.signal,
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(
        `Rentvine ${resp.status} ${resp.statusText}: ${body.slice(0, 200)}`,
      );
    }
    const text = await resp.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } finally {
    clearTimeout(timeout);
  }
}
