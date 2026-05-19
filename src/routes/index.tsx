import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Logo";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PartyPass — Tickets that get you in." },
      {
        name: "description",
        content:
          "Buy tickets, get an instant QR pass, and walk straight through the door. PartyPass is the fastest way to ticket a party.",
      },
      { property: "og:title", content: "PartyPass — Tickets that get you in." },
      {
        property: "og:description",
        content: "Buy tickets, get an instant QR pass, walk straight in.",
      },
    ],
  }),
  component: Home,
});

interface EventRow {
  id: string;
  title: string;
  date: string;
  venue: string;
  currency: string;
  cover_image_url: string | null;
  fromPrice: number | null;
}

function Home() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: evs } = await supabase
        .from("events")
        .select("id,title,date,venue,currency,cover_image_url")
        .gte("date", new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString())
        .order("date", { ascending: true })
        .limit(12);

      const list = evs ?? [];
      const ids = list.map((e) => e.id);
      let priceByEvent: Record<string, number> = {};
      if (ids.length) {
        const { data: cats } = await supabase
          .from("event_ticket_categories")
          .select("event_id, price, enabled")
          .in("event_id", ids)
          .eq("enabled", true);
        for (const c of cats ?? []) {
          const p = Number(c.price);
          const cur = priceByEvent[c.event_id as string];
          if (cur === undefined || p < cur) priceByEvent[c.event_id as string] = p;
        }
      }

      setEvents(
        list.map((e) => ({
          ...e,
          fromPrice: priceByEvent[e.id] ?? null,
        })) as EventRow[],
      );
      setLoading(false);
    })();
  }, []);

  return (
    <div className="min-h-screen">
      <header className="absolute top-0 inset-x-0 z-20 flex items-center justify-between p-6 md:px-10">
        <Logo />
        <Link
          to="/organizer/login"
          className="text-sm font-medium text-muted-foreground hover:text-foreground transition"
        >
          Organizer login →
        </Link>
      </header>

      {/* Hero */}
      <section className="relative isolate overflow-hidden">
        <div
          className="absolute inset-0 -z-10 bg-cover bg-center"
          style={{
            backgroundImage:
              "url('https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=2000&q=80')",
          }}
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-background/60 via-background/85 to-background" />
        <div className="mx-auto max-w-5xl px-6 pt-40 pb-32 text-center animate-float-up">
          <p className="inline-block text-xs uppercase tracking-[0.3em] text-accent mb-6">
            The pass for every party
          </p>
          <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold leading-[0.95] glow-text">
            Tickets that <span className="gradient-text">get you in.</span>
          </h1>
          <p className="mt-8 text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
            Buy a ticket, flash your QR at the door, walk straight through. No app,
            no queue, no fuss.
          </p>
        </div>
      </section>

      {/* Events */}
      <section className="mx-auto max-w-6xl px-6 pb-24 -mt-12">
        <div className="flex items-end justify-between mb-8">
          <h2 className="text-3xl md:text-4xl font-bold">Upcoming nights</h2>
          <span className="text-sm text-muted-foreground hidden sm:block">
            {events.length} event{events.length === 1 ? "" : "s"}
          </span>
        </div>

        {loading ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="glass rounded-2xl h-72 animate-pulse" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <div className="glass rounded-2xl p-12 text-center">
            <p className="text-muted-foreground">
              No events live yet. Check back soon — the parties are loading.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((e, i) => (
              <Link
                key={e.id}
                to="/event/$eventId"
                params={{ eventId: e.id }}
                className="group glass rounded-2xl overflow-hidden hover:-translate-y-1 transition-all duration-300 hover:glow-primary animate-float-up"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div
                  className="aspect-[4/3] bg-cover bg-center bg-muted"
                  style={{
                    backgroundImage: e.cover_image_url
                      ? `url('${e.cover_image_url}')`
                      : "url('https://images.unsplash.com/photo-1571266028243-d220bc6ec060?auto=format&fit=crop&w=1200&q=80')",
                  }}
                />
                <div className="p-5">
                  <p className="text-xs uppercase tracking-wider text-accent">
                    {new Date(e.date).toLocaleDateString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                  <h3 className="text-xl font-semibold mt-1 group-hover:gradient-text transition-colors">
                    {e.title}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1 truncate">{e.venue}</p>
                  {e.fromPrice !== null && (
                    <p className="text-sm font-semibold mt-3">
                      From Rs {e.fromPrice.toLocaleString()}
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <footer className="border-t border-border mt-12 py-8 px-6 text-center text-sm text-muted-foreground">
        <Logo className="mb-3" />
        <p>© {new Date().getFullYear()} PartyPass. Made for the dancefloor.</p>
      </footer>
    </div>
  );
}
