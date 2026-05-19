import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import {
  getFlutterwavePublicKey,
  verifyAndCreateTicket,
  createBankTransferTicket,
} from "@/lib/payment.functions";
import { loadFlutterwave } from "@/lib/flutterwave";
import { Logo } from "@/components/Logo";

export const Route = createFileRoute("/event/$eventId")({
  component: EventLandingPage,
});

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  date: string;
  venue: string;
  currency: string;
  cover_image_url: string | null;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  organizer_phone: string | null;
  bank_transfer_enabled: boolean;
}

interface CategoryWithStock {
  id: string;
  kind: "early_bird" | "regular" | "vip";
  price: number;
  quantity: number;
  description: string | null;
  sold: number;
}

type PayMethod = "card" | "bank_transfer";

const KIND_LABEL: Record<CategoryWithStock["kind"], string> = {
  early_bird: "Early Bird",
  regular: "Regular",
  vip: "VIP",
};

function EventLandingPage() {
  const { eventId } = Route.useParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState<EventRow | null>(null);
  const [categories, setCategories] = useState<CategoryWithStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<CategoryWithStock | null>(null);
  const [method, setMethod] = useState<PayMethod>("card");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bankInfo, setBankInfo] = useState<{
    reference: string;
    amount: number;
  } | null>(null);

  const getKey = useServerFn(getFlutterwavePublicKey);
  const verify = useServerFn(verifyAndCreateTicket);
  const createBT = useServerFn(createBankTransferTicket);

  useEffect(() => {
    (async () => {
      const [{ data: ev }, { data: cats }] = await Promise.all([
        supabase
          .from("events")
          .select(
            "id,title,description,date,venue,currency,cover_image_url,bank_name,bank_account_name,bank_account_number,organizer_phone,bank_transfer_enabled",
          )
          .eq("id", eventId)
          .maybeSingle(),
        supabase
          .from("event_ticket_categories")
          .select("id, kind, price, quantity, description, enabled")
          .eq("event_id", eventId)
          .eq("enabled", true),
      ]);
      setEvent(ev as EventRow | null);

      const catList = cats ?? [];
      const catIds = catList.map((c) => c.id);
      let soldByCat: Record<string, number> = {};
      if (catIds.length) {
        const { data: tk } = await supabase
          .from("tickets")
          .select("category_id, payment_status")
          .in("category_id", catIds)
          .eq("payment_status", "paid");
        for (const t of tk ?? []) {
          const k = t.category_id as string;
          soldByCat[k] = (soldByCat[k] ?? 0) + 1;
        }
      }
      const order: CategoryWithStock["kind"][] = ["early_bird", "regular", "vip"];
      const enriched = catList
        .map((c) => ({
          id: c.id as string,
          kind: c.kind as CategoryWithStock["kind"],
          price: Number(c.price),
          quantity: c.quantity as number,
          description: (c.description as string | null) ?? null,
          sold: soldByCat[c.id as string] ?? 0,
        }))
        .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
      setCategories(enriched);
      setLoading(false);
    })();
  }, [eventId]);

  async function handleContinue(e: React.FormEvent) {
    e.preventDefault();
    if (!event || !selected) return;
    setBusy(true);
    setError(null);

    if (method === "bank_transfer") {
      try {
        const { reference, amount } = await createBT({
          data: {
            eventId: event.id,
            categoryId: selected.id,
            attendeeName: name,
            attendeeEmail: email,
          },
        });
        setBankInfo({ reference, amount });
        setBusy(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not create ticket");
        setBusy(false);
      }
      return;
    }

    // Card via Flutterwave
    try {
      const [{ publicKey }] = await Promise.all([getKey(), loadFlutterwave()]);
      if (!publicKey) throw new Error("Payment provider not configured.");
      if (!window.FlutterwaveCheckout) throw new Error("Checkout not ready.");

      const tx_ref = `FLW-PARTYPASS-${crypto.randomUUID()}`;

      const checkout = window.FlutterwaveCheckout({
        public_key: publicKey,
        tx_ref,
        amount: selected.price,
        currency: event.currency || "MUR",
        payment_options: "card,ussd,banktransfer,mobilemoneyghana,mobilemoneyuganda",
        customer: { email, name },
        customizations: {
          title: event.title,
          description: `${KIND_LABEL[selected.kind]} ticket for ${event.title}`,
        },
        callback: async (data) => {
          try {
            if (checkout?.close) {
              checkout.close();
            } else if (typeof (window as any).closePaymentModal === "function") {
              (window as any).closePaymentModal();
            }

            const { ticketId } = await verify({
              data: {
                transactionId: data.transaction_id,
                eventId: event.id,
                categoryId: selected.id,
                attendeeName: name,
                attendeeEmail: email,
              },
            });
            navigate({ to: "/ticket/$ticketId", params: { ticketId } });
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not create ticket");
            setBusy(false);
          }
        },
        onclose: () => setBusy(false),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-12 w-12 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center px-6">
        <h1 className="text-4xl font-bold">Event not found</h1>
        <p className="text-muted-foreground mt-2">This party may have wrapped up.</p>
        <Link to="/" className="btn-glow mt-8">
          Back home
        </Link>
      </div>
    );
  }

  const dateFmt = new Date(event.date);
  const bankEnabled = !!(
    event.bank_transfer_enabled &&
    event.bank_name &&
    event.bank_account_name &&
    event.bank_account_number &&
    event.organizer_phone
  );

  // Bank-transfer confirmation screen
  if (bankInfo && selected) {
    return (
      <div className="min-h-screen p-6 md:p-10">
        <header className="flex items-center justify-between mb-8">
          <Logo />
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
            ← All events
          </Link>
        </header>
        <main className="mx-auto max-w-xl animate-float-up">
          <p className="text-xs uppercase tracking-[0.3em] text-accent mb-3">Bank transfer</p>
          <h1 className="text-3xl md:text-4xl font-bold">Transfer to confirm your seat</h1>
          <p className="text-muted-foreground mt-2">
            Send the exact amount below using the details provided, then notify the organizer.
          </p>

          <div className="glass-strong rounded-2xl p-6 mt-6 space-y-4">
            <BankRow label="Bank" value={event.bank_name!} />
            <BankRow label="Account name" value={event.bank_account_name!} />
            <BankRow label="Account number" value={event.bank_account_number!} copy />
            <BankRow label="Amount" value={`Rs ${bankInfo.amount.toLocaleString()}`} />
            <div className="pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground mb-1">
                Payment reference (include in your transfer description)
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-secondary/40 rounded-lg px-3 py-3 text-lg font-bold gradient-text break-all">
                  {bankInfo.reference}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(bankInfo.reference);
                    toast.success("Reference copied");
                  }}
                  className="px-3 py-3 rounded-lg border border-border hover:bg-secondary/50 text-sm font-medium"
                >
                  Copy
                </button>
              </div>
            </div>
          </div>

          <p className="text-sm text-muted-foreground mt-6 leading-relaxed glass rounded-xl p-4">
            Once you've made the transfer, wait for the organizer to confirm. Your ticket and QR
            code will be sent to your email once confirmed.
          </p>

          <Link
            to="/"
            className="block text-center text-sm text-muted-foreground mt-6 hover:text-foreground"
          >
            Back to events
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative">
      <div
        className="absolute inset-0 -z-10 bg-cover bg-center"
        style={{
          backgroundImage: event.cover_image_url
            ? `url('${event.cover_image_url}')`
            : "url('https://images.unsplash.com/photo-1429962714451-bb934ecdc4ec?auto=format&fit=crop&w=2000&q=80')",
        }}
      />
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-background/40 via-background/85 to-background" />

      <header className="flex items-center justify-between p-6 md:px-10">
        <Logo />
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← All events
        </Link>
      </header>

      <main className="mx-auto max-w-3xl px-6 pt-12 md:pt-24 pb-20 animate-float-up">
        <p className="text-xs uppercase tracking-[0.3em] text-accent mb-4">
          {dateFmt.toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
        </p>
        <h1 className="text-5xl md:text-7xl font-bold leading-tight glow-text">{event.title}</h1>
        <div className="mt-6 flex flex-wrap items-center gap-3 text-muted-foreground">
          <span className="glass px-4 py-2 rounded-full text-sm">📍 {event.venue}</span>
          <span className="glass px-4 py-2 rounded-full text-sm">
            🕘 {dateFmt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
          </span>
        </div>

        {event.description && (
          <p className="mt-8 text-lg text-foreground/80 leading-relaxed whitespace-pre-wrap">
            {event.description}
          </p>
        )}

        {/* Categories */}
        <div className="mt-12 space-y-3">
          <h2 className="text-2xl font-bold mb-2">Choose your ticket</h2>
          {categories.length === 0 ? (
            <p className="text-muted-foreground glass rounded-2xl p-6">
              Tickets aren't on sale yet.
            </p>
          ) : (
            categories.map((c) => {
              const remaining = c.quantity - c.sold;
              const soldOut = remaining <= 0;
              const isSelected = selected?.id === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={soldOut}
                  onClick={() => {
                    setSelected(c);
                    setError(null);
                    window.setTimeout(() => {
                      document.getElementById("attendee-form")?.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                      });
                    }, 0);
                  }}
                  className={[
                    "w-full text-left rounded-2xl p-5 border transition flex items-center justify-between gap-4",
                    soldOut
                      ? "glass opacity-50 cursor-not-allowed border-border"
                      : isSelected
                        ? "glass-strong border-primary glow-primary"
                        : "glass border-border hover:border-primary/60",
                  ].join(" ")}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-lg font-semibold">{KIND_LABEL[c.kind]}</p>
                      {soldOut && (
                        <span className="text-xs uppercase tracking-wider px-2 py-0.5 rounded-full bg-destructive/20 text-destructive">
                          Sold out
                        </span>
                      )}
                    </div>
                    {c.description && (
                      <p className="text-sm text-muted-foreground mt-1">{c.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">
                      {soldOut ? "0" : remaining} of {c.quantity} remaining
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xl font-bold gradient-text">Rs {c.price.toLocaleString()}</p>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {selected && (
          <form
            id="attendee-form"
            onSubmit={handleContinue}
            style={{ scrollMarginTop: "5rem" }}
            className="glass-strong rounded-2xl p-6 md:p-8 space-y-5 max-w-lg mt-8"
          >
            <h3 className="text-xl font-semibold">Almost there — {KIND_LABEL[selected.kind]}</h3>
            <div>
              <label className="text-sm text-muted-foreground">Full name</label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full mt-1 bg-input/60 border border-border rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-primary"
                placeholder="Ada Lovelace"
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Email</label>
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full mt-1 bg-input/60 border border-border rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-primary"
                placeholder="you@email.com"
              />
            </div>

            {/* Payment method selector */}
            <div>
              <p className="text-sm text-muted-foreground mb-2">Payment method</p>
              <div
                className={
                  bankEnabled ? "grid grid-cols-1 sm:grid-cols-2 gap-3" : "grid grid-cols-1 gap-3"
                }
              >
                <MethodCard
                  active={method === "card"}
                  onClick={() => setMethod("card")}
                  icon="💳"
                  title="Pay by Card"
                  line1="Instant ticket delivery"
                  line2="Powered by Flutterwave"
                />
                {bankEnabled && (
                  <MethodCard
                    active={method === "bank_transfer"}
                    onClick={() => setMethod("bank_transfer")}
                    icon="🏦"
                    title="Pay by Bank Transfer"
                    line1="Ticket sent after confirmation"
                    line2="Free · No fees"
                  />
                )}
              </div>
            </div>

            {error && (
              <p className="text-sm text-destructive bg-destructive/10 px-4 py-2 rounded-lg">
                {error}
              </p>
            )}
            <button type="submit" disabled={busy} className="btn-glow w-full">
              {busy ? "Please wait…" : "Continue"}
            </button>
            <p className="text-xs text-muted-foreground text-center">
              {method === "card"
                ? "Secure payment by Flutterwave. You'll get your QR ticket instantly."
                : "You'll receive bank details to complete your transfer."}
            </p>
          </form>
        )}
      </main>
    </div>
  );
}

function MethodCard({
  active,
  onClick,
  icon,
  title,
  line1,
  line2,
}: {
  active: boolean;
  onClick: () => void;
  icon: string;
  title: string;
  line1: string;
  line2: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "text-left rounded-xl p-4 border-2 transition",
        active
          ? "border-primary bg-primary/10"
          : "border-border bg-secondary/20 hover:border-primary/50",
      ].join(" ")}
    >
      <p className="text-2xl">{icon}</p>
      <p className="font-semibold mt-1">{title}</p>
      <p className="text-xs text-muted-foreground mt-1">{line1}</p>
      <p className="text-xs text-muted-foreground">{line2}</p>
    </button>
  );
}

function BankRow({ label, value, copy }: { label: string; value: string; copy?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2 mt-1">
        <p className="flex-1 font-medium break-all">{value}</p>
        {copy && (
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(value);
              toast.success(`${label} copied`);
            }}
            className="text-xs px-2 py-1 rounded border border-border hover:bg-secondary/50"
          >
            Copy
          </button>
        )}
      </div>
    </div>
  );
}
