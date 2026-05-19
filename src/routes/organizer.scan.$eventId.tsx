import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Logo";

export const Route = createFileRoute("/organizer/scan/$eventId")({
  component: ScannerPage,
});

type Flash =
  | { kind: "ok"; name: string }
  | { kind: "already"; name: string; at: string | null }
  | { kind: "invalid" }
  | null;

function ScannerPage() {
  const { eventId } = Route.useParams();
  const navigate = useNavigate();
  const [eventTitle, setEventTitle] = useState("");
  const [counts, setCounts] = useState({ sold: 0, checkedIn: 0 });
  const [flash, setFlash] = useState<Flash>(null);
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);
  const isProcessingRef = useRef(false);
  const lastScanRef = useRef<{ id: string; t: number } | null>(null);

  // Auth + load event
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) {
        navigate({ to: "/organizer/login" });
        return;
      }
      const { data: ev } = await supabase
        .from("events")
        .select("title, organizer_id")
        .eq("id", eventId)
        .maybeSingle();
      if (!ev || ev.organizer_id !== data.session.user.id) {
        navigate({ to: "/organizer/dashboard" });
        return;
      }
      setEventTitle(ev.title);
      refreshCounts();
    });
  }, [eventId, navigate]);

  async function refreshCounts() {
    const { data } = await supabase
      .from("tickets")
      .select("payment_status, checked_in")
      .eq("event_id", eventId);
    let sold = 0;
    let checkedIn = 0;
    for (const t of data ?? []) {
      if (t.payment_status === "paid") sold += 1;
      if (t.checked_in) checkedIn += 1;
    }
    setCounts({ sold, checkedIn });
  }

  // Start camera
  useEffect(() => {
    let cancelled = false;
    let scanner: any = null;
    (async () => {
      try {
        const mod = await import("html5-qrcode");
        const { Html5Qrcode } = mod;
        if (cancelled) return;
        scanner = new Html5Qrcode("qr-reader");
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 260, height: 260 } },
          handleDecoded,
          () => {},
        );
      } catch (e) {
        setError(
          e instanceof Error
            ? `Camera error: ${e.message}. Please grant camera permission.`
            : "Camera error.",
        );
      }
    })();

    return () => {
      cancelled = true;
      if (scanner) {
        scanner
          .stop()
          .then(() => scanner.clear())
          .catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDecoded(decodedText: string) {
    if (isProcessingRef.current) return;
    // Debounce same code
    const now = Date.now();
    if (lastScanRef.current && lastScanRef.current.id === decodedText && now - lastScanRef.current.t < 3000) {
      return;
    }
    lastScanRef.current = { id: decodedText, t: now };

    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRe.test(decodedText)) {
      isProcessingRef.current = true;
      setFlash({ kind: "invalid" });
      setTimeout(() => {
        setFlash(null);
        isProcessingRef.current = false;
      }, 2500);
      return;
    }

    isProcessingRef.current = true;
    try {
      const { data: ticket, error } = await supabase
        .from("tickets")
        .select("id, event_id, attendee_name, payment_status, checked_in, checked_in_at")
        .eq("id", decodedText)
        .maybeSingle();
      if (error) throw new Error(error.message);

      if (!ticket || ticket.event_id !== eventId || ticket.payment_status !== "paid") {
        setFlash({ kind: "invalid" });
      } else if (ticket.checked_in) {
        setFlash({
          kind: "already",
          name: ticket.attendee_name,
          at: ticket.checked_in_at,
        });
      } else {
        const nowIso = new Date().toISOString();
        const { error: updateError } = await supabase
          .from("tickets")
          .update({ checked_in: true, checked_in_at: nowIso })
          .eq("id", ticket.id);
        if (updateError) throw new Error(updateError.message);
        setFlash({ kind: "ok", name: ticket.attendee_name });
        setCounts((c) => ({ ...c, checkedIn: c.checkedIn + 1 }));
      }
    } catch {
      setFlash({ kind: "invalid" });
    }
    setTimeout(() => {
      setFlash(null);
      isProcessingRef.current = false;
    }, 2500);
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between p-4 md:px-8 border-b border-border z-30">
        <Logo />
        <Link
          to="/organizer/dashboard"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Dashboard
        </Link>
      </header>

      <div className="px-4 py-3 flex items-center justify-between text-sm border-b border-border bg-card/30">
        <span className="font-medium truncate max-w-[60%]">{eventTitle}</span>
        <span className="font-mono">
          <span className="gradient-text font-bold">{counts.checkedIn}</span>
          <span className="text-muted-foreground"> / {counts.sold}</span>
        </span>
      </div>

      <main className="flex-1 relative bg-black">
        <div id="qr-reader" className="w-full h-full" style={{ minHeight: "60vh" }} />

        {/* Reticle overlay */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative w-[280px] h-[280px]">
            <span className="absolute top-0 left-0 w-12 h-12 border-t-4 border-l-4 border-primary rounded-tl-2xl" />
            <span className="absolute top-0 right-0 w-12 h-12 border-t-4 border-r-4 border-primary rounded-tr-2xl" />
            <span className="absolute bottom-0 left-0 w-12 h-12 border-b-4 border-l-4 border-primary rounded-bl-2xl" />
            <span className="absolute bottom-0 right-0 w-12 h-12 border-b-4 border-r-4 border-primary rounded-br-2xl" />
          </div>
        </div>

        {error && (
          <div className="absolute bottom-6 inset-x-4 glass-strong rounded-xl p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Flash overlay */}
        {flash && (
          <div
            className={`absolute inset-0 flex flex-col items-center justify-center text-center px-6 animate-float-up ${
              flash.kind === "ok"
                ? "bg-success/90"
                : flash.kind === "already"
                  ? "bg-warning/90"
                  : "bg-destructive/90"
            }`}
            style={{ color: "white" }}
          >
            <div className="text-7xl mb-4">
              {flash.kind === "ok" ? "✅" : flash.kind === "already" ? "⚠️" : "❌"}
            </div>
            <h2 className="text-3xl md:text-4xl font-bold">
              {flash.kind === "ok" && `Welcome, ${flash.name}!`}
              {flash.kind === "already" && "Already checked in"}
              {flash.kind === "invalid" && "Invalid ticket"}
            </h2>
            <p className="mt-2 text-lg opacity-90">
              {flash.kind === "ok" && "Check-in successful."}
              {flash.kind === "already" &&
                (flash.name +
                  (flash.at
                    ? ` · ${new Date(flash.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                    : ""))}
              {flash.kind === "invalid" && "Not found, unpaid, or wrong event."}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
