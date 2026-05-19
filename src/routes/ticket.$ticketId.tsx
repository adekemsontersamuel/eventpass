import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { QRCodeCanvas } from "qrcode.react";
import html2canvas from "html2canvas";
import { Logo } from "@/components/Logo";

export const Route = createFileRoute("/ticket/$ticketId")({
  component: TicketPage,
});

interface TicketWithEvent {
  id: string;
  attendee_name: string;
  attendee_email: string;
  payment_status: string;
  events: {
    title: string;
    date: string;
    venue: string;
  } | null;
}

function TicketPage() {
  const { ticketId } = Route.useParams();
  const [ticket, setTicket] = useState<TicketWithEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase
      .from("tickets")
      .select("id,attendee_name,attendee_email,payment_status,events(title,date,venue)")
      .eq("id", ticketId)
      .maybeSingle()
      .then(({ data }) => {
        setTicket(data as unknown as TicketWithEvent | null);
        setLoading(false);
      });
  }, [ticketId]);

  async function handleDownload() {
    if (!cardRef.current) return;
    try {
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: "#0a0612",
        scale: 2,
        useCORS: true,
      });

      // Prefer blob + object URL for more reliable downloads
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `partypass-${ticketId.slice(0, 8)}.png`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      }, "image/png");
      return;
    } catch (err) {
      // html2canvas may fail in some environments; fall back to QR canvas if present
      console.error("html2canvas failed, falling back to direct canvas export:", err);
    }

    // Fallback: try to find the QR canvas element and export it directly
    try {
      const qrCanvas = cardRef.current.querySelector("canvas");
      if (qrCanvas && qrCanvas instanceof HTMLCanvasElement) {
        const dataUrl = qrCanvas.toDataURL("image/png");
        const link = document.createElement("a");
        link.href = dataUrl;
        link.download = `partypass-${ticketId.slice(0, 8)}.png`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        return;
      }
    } catch (err) {
      console.error("Fallback QR canvas export failed:", err);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-12 w-12 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!ticket || !ticket.events) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center px-6">
        <h1 className="text-4xl font-bold">Ticket not found</h1>
        <Link to="/" className="btn-glow mt-8">
          Back home
        </Link>
      </div>
    );
  }

  const dateFmt = new Date(ticket.events.date);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between p-6 md:px-10">
        <Logo />
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
          Home
        </Link>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 py-10 animate-float-up">
        <p className="text-sm text-success mb-4">✓ Payment confirmed</p>
        <h1 className="text-3xl md:text-4xl font-bold mb-2">Your pass is ready</h1>
        <p className="text-muted-foreground mb-8 text-center">
          Show this QR at the door. Screenshot or download it.
        </p>

        <div
          ref={cardRef}
          className="relative w-full max-w-sm rounded-3xl overflow-hidden glass-strong p-8"
          style={{
            background:
              "linear-gradient(145deg, oklch(0.18 0.04 290 / 0.95), oklch(0.13 0.04 305 / 0.95))",
          }}
        >
          <div className="absolute -inset-px rounded-3xl pointer-events-none animate-shimmer" />

          <div className="text-center">
            <p className="text-xs uppercase tracking-[0.3em] text-accent mb-2">PartyPass</p>
            <h2 className="text-2xl font-bold gradient-text leading-tight">
              {ticket.events.title}
            </h2>
            <p className="text-sm text-muted-foreground mt-2">
              {dateFmt.toLocaleDateString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}{" "}
              ·{" "}
              {dateFmt.toLocaleTimeString(undefined, {
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
            <p className="text-sm text-muted-foreground">{ticket.events.venue}</p>
          </div>

          {/* QR with shimmer */}
          <div className="mt-8 flex items-center justify-center">
            <div className="relative">
              <div className="absolute -inset-3 rounded-2xl bg-gradient-to-br from-primary to-accent opacity-50 blur-xl animate-shimmer" />
              <div className="relative bg-white p-4 rounded-2xl">
                <QRCodeCanvas
                  value={ticket.id}
                  size={220}
                  level="H"
                  bgColor="#ffffff"
                  fgColor="#0a0612"
                />
              </div>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-white/10 text-center">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Attendee</p>
            <p className="text-lg font-semibold mt-1">{ticket.attendee_name}</p>
            <p className="text-xs text-muted-foreground mt-3 font-mono">
              #{ticket.id.slice(0, 8).toUpperCase()}
            </p>
          </div>
        </div>

        <button onClick={handleDownload} className="btn-glow mt-8">
          ↓ Download Ticket
        </button>
        <p className="text-xs text-muted-foreground mt-4 max-w-sm text-center">
          Tip: take a screenshot too — works even without internet at the door.
        </p>
      </main>
    </div>
  );
}
