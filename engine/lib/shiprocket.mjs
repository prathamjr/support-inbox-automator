// Shiprocket API client: login + JSON requests with retries on network blips.
// Retries matter: a laptop that just woke from sleep often has no network for a
// few seconds, and without retries the whole day's run ships nothing.
export const SR = "https://apiv2.shiprocket.in";
export const SERVICEABILITY = "https://serviceability.shiprocket.in";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createClient({ email, password }) {
  let token = null;

  async function api(method, url, body, attempt = 1) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (networkErr) {
      if (attempt < 4) {
        await sleep(attempt * 3000);
        return api(method, url, body, attempt + 1);
      }
      throw new Error(`${method} ${url} -> network error after ${attempt} attempts: ${networkErr.message}`);
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!res.ok) {
      const err = new Error(`${method} ${url} -> HTTP ${res.status}: ${text.slice(0, 500)}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async function login() {
    if (!email || !password) throw new Error("SHIPROCKET_EMAIL / SHIPROCKET_PASSWORD missing in engine/.env");
    const data = await api("POST", `${SR}/v1/external/auth/login`, { email, password });
    if (!data.token) throw new Error("Shiprocket login failed: no token in response");
    token = data.token;
  }

  /** Pickup nickname (lowercase) -> { name, pincode, city } */
  async function pickupLocations() {
    const data = await api("GET", `${SR}/v1/external/settings/company/pickup`);
    const out = {};
    for (const a of data?.data?.shipping_address ?? []) {
      out[String(a.pickup_location).toLowerCase()] = { name: a.pickup_location, pincode: String(a.pin_code), city: a.city, state: a.state };
    }
    return out;
  }

  /**
   * Orders between two YYYY-MM-DD dates. ALWAYS pass both: without "from" the API
   * silently falls back to ~30 days, and a span wider than ~320 days returns an
   * empty list with no error.
   */
  async function orders({ from, to, newOnly = false, maxPages = 20 }) {
    const out = [];
    for (let page = 1; page <= maxPages; page++) {
      const filter = newOnly ? "&filter_by=status&filter=1" : "";
      const data = await api("GET", `${SR}/v1/external/orders?per_page=50&page=${page}&sort=DESC&sort_by=created_at&from=${from}&to=${to}${filter}`);
      const batch = data?.data ?? [];
      out.push(...batch);
      if (batch.length < 50) break;
    }
    return out;
  }

  async function walletBalance() {
    const bal = await api("GET", `${SR}/v1/external/account/details/wallet-balance`);
    const n = Number(bal?.data?.balance_amount ?? NaN);
    return Number.isFinite(n) ? n : null;
  }

  return { api, login, pickupLocations, orders, walletBalance };
}
