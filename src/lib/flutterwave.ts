// Loads the Flutterwave inline checkout script and exposes a typed wrapper.

declare global {
  interface Window {
    FlutterwaveCheckout?: (config: FlutterwaveConfig) => { close: () => void };
  }
}

export interface FlutterwaveConfig {
  public_key: string;
  tx_ref: string;
  amount: number;
  currency: string;
  payment_options?: string;
  redirect_url?: string;
  customer: { email: string; name: string };
  customizations: { title: string; description: string; logo?: string };
  callback: (data: { transaction_id: number | string; status: string; tx_ref: string }) => void;
  onclose: () => void;
}

const SCRIPT_URL = "https://checkout.flutterwave.com/v3.js";

let loadPromise: Promise<void> | null = null;

export function loadFlutterwave(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("Browser only"));
  if (window.FlutterwaveCheckout) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_URL}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load Flutterwave")));
      return;
    }
    const s = document.createElement("script");
    s.src = SCRIPT_URL;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Flutterwave"));
    document.head.appendChild(s);
  });
  return loadPromise;
}
