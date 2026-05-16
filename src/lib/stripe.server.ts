// Server-only Stripe helpers. Routes API calls through Lovable's
// connector gateway — the STRIPE_*_API_KEY values are gateway connection
// identifiers, not real Stripe secret keys, so they MUST go through
// the gateway (Authorization: Bearer LOVABLE_API_KEY +
// X-Connection-Api-Key: STRIPE_*_API_KEY).

export type StripeEnv = "sandbox" | "live";

const GATEWAY_BASE = "https://connector-gateway.lovable.dev/stripe";

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function apiKey(env: StripeEnv): string {
  return env === "sandbox"
    ? getEnv("STRIPE_SANDBOX_API_KEY")
    : getEnv("STRIPE_LIVE_API_KEY");
}

// Encode a nested object/array structure into the Stripe-style
// application/x-www-form-urlencoded body (bracket notation).
function encodeForm(data: unknown, prefix = ""): string[] {
  const parts: string[] = [];
  if (data === undefined || data === null) return parts;
  if (Array.isArray(data)) {
    data.forEach((v, i) => {
      parts.push(...encodeForm(v, `${prefix}[${i}]`));
    });
  } else if (typeof data === "object") {
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (v === undefined) continue;
      const key = prefix ? `${prefix}[${k}]` : k;
      parts.push(...encodeForm(v, key));
    }
  } else {
    parts.push(
      `${encodeURIComponent(prefix)}=${encodeURIComponent(String(data))}`,
    );
  }
  return parts;
}

async function call<T = any>(
  env: StripeEnv,
  method: "GET" | "POST",
  path: string,
  payload?: Record<string, unknown>,
  query?: Record<string, unknown>,
): Promise<T> {
  let url = `${GATEWAY_BASE}${path}`;
  if (query) {
    const qs = encodeForm(query).join("&");
    if (qs) url += `?${qs}`;
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getEnv("LOVABLE_API_KEY")}`,
    "X-Connection-Api-Key": apiKey(env),
  };
  let body: string | undefined;
  if (method === "POST") {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = payload ? encodeForm(payload).join("&") : "";
  }
  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // not JSON
  }
  if (!res.ok) {
    const msg = json?.error?.message || text || `Stripe error ${res.status}`;
    throw new Error(`Stripe ${method} ${path} failed: ${msg}`);
  }
  return json as T;
}

export function createStripeClient(env: StripeEnv) {
  return {
    prices: {
      list: (params: { lookup_keys?: string[]; limit?: number }) =>
        call(env, "GET", "/v1/prices", undefined, params),
    },
    customers: {
      search: (params: { query: string; limit?: number }) =>
        call(env, "GET", "/v1/customers/search", undefined, params),
      list: (params: { email?: string; limit?: number }) =>
        call(env, "GET", "/v1/customers", undefined, params),
      create: (params: Record<string, unknown>) =>
        call(env, "POST", "/v1/customers", params),
      update: (id: string, params: Record<string, unknown>) =>
        call(env, "POST", `/v1/customers/${id}`, params),
    },
    checkout: {
      sessions: {
        create: (params: Record<string, unknown>) =>
          call(env, "POST", "/v1/checkout/sessions", params),
      },
    },
    billingPortal: {
      sessions: {
        create: (params: Record<string, unknown>) =>
          call(env, "POST", "/v1/billing_portal/sessions", params),
      },
    },
    subscriptions: {
      retrieve: (id: string) =>
        call(env, "GET", `/v1/subscriptions/${id}`),
    },
  };
}

// HMAC-SHA256 verification of Stripe webhook signatures. Does not use the
// Stripe SDK — pure Web Crypto so it works directly inside server routes.
export async function verifyWebhook(
  req: Request,
  env: StripeEnv,
): Promise<{ type: string; data: { object: any } }> {
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();
  const secret =
    env === "sandbox"
      ? getEnv("PAYMENTS_SANDBOX_WEBHOOK_SECRET")
      : getEnv("PAYMENTS_LIVE_WEBHOOK_SECRET");

  if (!signature || !body) throw new Error("Missing signature or body");

  let timestamp: string | undefined;
  const v1: string[] = [];
  for (const part of signature.split(",")) {
    const [k, v] = part.split("=", 2);
    if (k === "t") timestamp = v;
    if (k === "v1") v1.push(v);
  }
  if (!timestamp || v1.length === 0) throw new Error("Invalid signature format");

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) throw new Error("Webhook timestamp too old");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  const expected = Array.from(new Uint8Array(signed))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (!v1.includes(expected)) throw new Error("Invalid webhook signature");

  return JSON.parse(body);
}