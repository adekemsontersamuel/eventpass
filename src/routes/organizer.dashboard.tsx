import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Trash2, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Logo";

export const Route = createFileRoute("/organizer/dashboard")({
  component: OrganizerDashboard,
});

type Kind = "early_bird" | "regular" | "vip";
const KIND_ORDER: Kind[] = ["early_bird", "regular", "vip"];
const KIND_LABEL: Record<Kind, string> = {
  early_bird: "Early Bird",
  regular: "Regular",
  vip: "VIP",
};

interface CategoryRow {
  id: string;
  kind: Kind;
  enabled: boolean;
  price: number;
  quantity: number;
  description: string | null;
  sold: number;
}

interface EventWithCounts {
  id: string;
  title: string;
  description: string | null;
  date: string;
  venue: string;
  currency: string;
  cover_image_url: string | null;
  organizer_id: string;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  organizer_phone: string | null;
  bank_transfer_enabled: boolean;
  categories: CategoryRow[];
  totalSold: number;
  checkedIn: number;
}

interface PendingTicket {
  id: string;
  event_id: string;
  event_title: string;
  attendee_name: string;
  attendee_email: string;
  category_label: string;
  amount: number;
  payment_reference: string | null;
  created_at: string;
}

function OrganizerDashboard() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<EventWithCounts[]>([]);
  const [pending, setPending] = useState<PendingTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EventWithCounts | null>(null);
  const [creating, setCreating] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<EventWithCounts | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [decidingId, setDecidingId] = useState<string | null>(null);

  async function handleDecide(t: PendingTicket, decision: "approve" | "reject") {
    setDecidingId(t.id);
    try {
      const { error } = await supabase
        .from("tickets")
        .update({ payment_status: decision === "approve" ? "paid" : "rejected" })
        .eq("id", t.id)
        .eq("event_id", t.event_id)
        .eq("payment_status", "pending")
        .eq("payment_method", "bank_transfer");
      if (error) throw new Error(error.message);
      setPending((prev) => prev.filter((p) => p.id !== t.id));
      if (decision === "approve") {
        toast.success(`Ticket approved for ${t.attendee_email}`);
        if (userId) loadEvents(userId);
      } else {
        toast("Ticket rejected");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Action failed";
      toast.error(message);
    } finally {
      setDecidingId(null);
    }
  }

  async function handleDelete(ev: EventWithCounts) {
    setDeleting(true);
    const { error } = await supabase.from("events").delete().eq("id", ev.id);
    setDeleting(false);
    if (error) {
      toast.error(error.message || "Could not delete event");
      return;
    }
    setEvents((prev) => prev.filter((e) => e.id !== ev.id));
    setConfirmDelete(null);
    toast.success("Event deleted successfully.");
  }

  async function loadEvents(uid: string) {
    setLoading(true);
    const { data: evs } = await supabase
      .from("events")
      .select(
        "id,title,description,date,venue,currency,cover_image_url,organizer_id,bank_name,bank_account_name,bank_account_number,organizer_phone,bank_transfer_enabled",
      )
      .eq("organizer_id", uid)
      .order("date", { ascending: false });

    const list = evs ?? [];
    const eventIds = list.map((e) => e.id);

    let categoriesByEvent: Record<string, CategoryRow[]> = {};
    let countsByEvent: Record<string, { totalSold: number; checkedIn: number }> = {};
    let soldByCategory: Record<string, number> = {};

    if (eventIds.length) {
      const [{ data: cats }, { data: tk }] = await Promise.all([
        supabase
          .from("event_ticket_categories")
          .select("id, event_id, kind, enabled, price, quantity, description")
          .in("event_id", eventIds),
        supabase
          .from("tickets")
          .select("event_id, category_id, payment_status, checked_in")
          .in("event_id", eventIds),
      ]);

      for (const t of tk ?? []) {
        const ek = t.event_id as string;
        countsByEvent[ek] ||= { totalSold: 0, checkedIn: 0 };
        if (t.payment_status === "paid") {
          countsByEvent[ek].totalSold += 1;
          if (t.category_id) {
            const ck = t.category_id as string;
            soldByCategory[ck] = (soldByCategory[ck] ?? 0) + 1;
          }
        }
        if (t.checked_in) countsByEvent[ek].checkedIn += 1;
      }

      for (const c of cats ?? []) {
        const ek = c.event_id as string;
        categoriesByEvent[ek] ||= [];
        categoriesByEvent[ek].push({
          id: c.id as string,
          kind: c.kind as Kind,
          enabled: c.enabled as boolean,
          price: Number(c.price),
          quantity: c.quantity as number,
          description: (c.description as string | null) ?? null,
          sold: soldByCategory[c.id as string] ?? 0,
        });
      }
      for (const ek of Object.keys(categoriesByEvent)) {
        categoriesByEvent[ek].sort(
          (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
        );
      }
    }

    setEvents(
      list.map((e) => ({
        ...e,
        categories: categoriesByEvent[e.id] ?? [],
        totalSold: countsByEvent[e.id]?.totalSold ?? 0,
        checkedIn: countsByEvent[e.id]?.checkedIn ?? 0,
      })) as EventWithCounts[],
    );

    // Fetch pending bank-transfer tickets for this organizer's events
    if (eventIds.length) {
      const { data: pend } = await supabase
        .from("tickets")
        .select(
          "id, event_id, attendee_name, attendee_email, payment_reference, amount_paid, category_id, created_at",
        )
        .in("event_id", eventIds)
        .eq("payment_status", "pending")
        .eq("payment_method", "bank_transfer")
        .order("created_at", { ascending: false });

      const titleByEvent: Record<string, string> = {};
      for (const e of list) titleByEvent[e.id] = e.title;
      const catLabelById: Record<string, string> = {};
      for (const ek of Object.keys(categoriesByEvent)) {
        for (const c of categoriesByEvent[ek]) catLabelById[c.id] = KIND_LABEL[c.kind];
      }
      setPending(
        (pend ?? []).map((t) => ({
          id: t.id as string,
          event_id: t.event_id as string,
          event_title: titleByEvent[t.event_id as string] ?? "Event",
          attendee_name: t.attendee_name as string,
          attendee_email: t.attendee_email as string,
          category_label: catLabelById[t.category_id as string] ?? "Ticket",
          amount: Number(t.amount_paid ?? 0),
          payment_reference: (t.payment_reference as string | null) ?? null,
          created_at: t.created_at as string,
        })),
      );
    } else {
      setPending([]);
    }

    setLoading(false);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        navigate({ to: "/organizer/login" });
        return;
      }
      setUserId(data.session.user.id);
      loadEvents(data.session.user.id);
    });
  }, [navigate]);

  async function logout() {
    await supabase.auth.signOut();
    navigate({ to: "/organizer/login" });
  }

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between p-6 md:px-10 border-b border-border">
        <Logo />
        <button onClick={logout} className="text-sm text-muted-foreground hover:text-foreground">
          Sign out
        </button>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-accent">Dashboard</p>
            <h1 className="text-4xl font-bold mt-1">Your events</h1>
          </div>
          {/*<button onClick={() => setCreating(true)} className="btn-glow">
            + New event
          </button>
          */}
        </div>

        {pending.length > 0 && (
          <section className="mb-10 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 md:p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-amber-400">
                  Pending approvals
                </p>
                <h2 className="text-xl font-bold mt-1">
                  Bank transfers awaiting confirmation ({pending.length})
                </h2>
              </div>
            </div>
            <div className="space-y-2">
              {pending.map((t) => (
                <div
                  key={t.id}
                  className="rounded-xl bg-background/50 border border-amber-500/30 p-4 flex flex-col md:flex-row md:items-center gap-3 md:gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">
                      {t.attendee_name}{" "}
                      <span className="text-muted-foreground font-normal">
                        · {t.attendee_email}
                      </span>
                    </p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {t.event_title} · {t.category_label} · Rs {t.amount.toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Ref: <code className="text-amber-300">{t.payment_reference ?? "—"}</code> ·{" "}
                      {timeAgo(t.created_at)}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={decidingId === t.id}
                      onClick={() => handleDecide(t, "approve")}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold transition disabled:opacity-60"
                    >
                      <Check className="h-4 w-4" /> Approve
                    </button>
                    <button
                      type="button"
                      disabled={decidingId === t.id}
                      onClick={() => handleDecide(t, "reject")}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-destructive hover:opacity-90 text-destructive-foreground text-sm font-semibold transition disabled:opacity-60"
                    >
                      <X className="h-4 w-4" /> Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {loading ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="glass rounded-2xl h-64 animate-pulse" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <div className="glass rounded-2xl p-12 text-center">
            <p className="text-muted-foreground">
              No events yet. Hit "New event" to launch your first party.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((e) => (
              <div key={e.id} className="glass rounded-2xl overflow-hidden flex flex-col">
                <div
                  className="aspect-[4/3] bg-cover bg-center bg-muted"
                  style={{
                    backgroundImage: e.cover_image_url
                      ? `url('${e.cover_image_url}')`
                      : "url('https://images.unsplash.com/photo-1571266028243-d220bc6ec060?auto=format&fit=crop&w=1200&q=80')",
                  }}
                />
                <div className="p-5 flex flex-col flex-1">
                  <p className="text-xs uppercase tracking-wider text-accent">
                    {new Date(e.date).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                  <h3 className="text-xl font-semibold mt-1">{e.title}</h3>
                  <p className="text-sm text-muted-foreground truncate">{e.venue}</p>

                  {/* Per-category inventory */}
                  <div className="mt-4 space-y-1.5">
                    {e.categories.filter((c) => c.enabled).length === 0 ? (
                      <p className="text-xs text-muted-foreground italic">
                        No active ticket categories
                      </p>
                    ) : (
                      e.categories
                        .filter((c) => c.enabled)
                        .map((c) => {
                          const remaining = Math.max(0, c.quantity - c.sold);
                          return (
                            <div
                              key={c.id}
                              className="flex items-center justify-between text-sm bg-secondary/30 rounded-lg px-3 py-1.5"
                            >
                              <span className="font-medium">{KIND_LABEL[c.kind]}</span>
                              <span className="text-muted-foreground">
                                {remaining} of {c.quantity} remaining
                              </span>
                            </div>
                          );
                        })
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3 mt-4 mb-4">
                    <div className="bg-secondary/40 rounded-lg p-3">
                      <p className="text-xs text-muted-foreground">Sold</p>
                      <p className="text-2xl font-bold">{e.totalSold}</p>
                    </div>
                    <div className="bg-secondary/40 rounded-lg p-3">
                      <p className="text-xs text-muted-foreground">Checked in</p>
                      <p className="text-2xl font-bold gradient-text">{e.checkedIn}</p>
                    </div>
                  </div>

                  <div className="mt-auto flex gap-2 flex-wrap">
                    <Link
                      to="/event/$eventId"
                      params={{ eventId: e.id }}
                      target="_blank"
                      className="flex-1 min-w-[80px] text-center px-3 py-2 rounded-lg border border-border hover:bg-secondary/50 text-sm font-medium transition"
                    >
                      View
                    </Link>
                    <Link
                      to="/organizer/scan/$eventId"
                      params={{ eventId: e.id }}
                      className="flex-1 min-w-[100px] text-center px-3 py-2 rounded-lg gradient-primary text-white text-sm font-semibold transition hover:opacity-90"
                    >
                      Scanner
                    </Link>
                    <button
                      type="button"
                      onClick={() => setEditing(e)}
                      aria-label={`Edit ${e.title}`}
                      title="Edit event"
                      className="px-3 py-2 rounded-lg border border-border hover:bg-secondary/50 transition"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(e)}
                      aria-label={`Delete ${e.title}`}
                      title="Delete event"
                      className="px-3 py-2 rounded-lg border border-destructive/40 text-destructive hover:bg-destructive/10 transition"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {creating && userId && (
        <EventModal
          mode="create"
          userId={userId}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            loadEvents(userId);
          }}
        />
      )}

      {editing && userId && (
        <EventModal
          mode="edit"
          userId={userId}
          existing={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            loadEvents(userId);
          }}
        />
      )}

      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4 animate-float-up"
          onClick={() => !deleting && setConfirmDelete(null)}
        >
          <div
            className="glass-strong rounded-3xl p-6 md:p-8 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-2xl font-bold">Delete event?</h2>
            <p className="text-sm text-muted-foreground mt-3">
              Are you sure you want to delete{" "}
              <span className="text-foreground font-medium">{confirmDelete.title}</span>? This will
              permanently remove the event and all its tickets. This action cannot be undone.
            </p>
            <div className="flex gap-3 pt-6">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setConfirmDelete(null)}
                className="flex-1 px-4 py-3 rounded-lg border border-border hover:bg-secondary/50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => handleDelete(confirmDelete)}
                className="flex-1 px-4 py-3 rounded-lg bg-destructive text-destructive-foreground font-semibold hover:opacity-90 transition disabled:opacity-60"
              >
                {deleting ? "Deleting…" : "Confirm Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface CategoryDraft {
  id: string | null;
  kind: Kind;
  enabled: boolean;
  price: string;
  quantity: string;
  description: string;
  sold: number; // snapshot for edit-mode min-quantity validation
}

function emptyDrafts(): CategoryDraft[] {
  return KIND_ORDER.map((kind) => ({
    id: null,
    kind,
    enabled: kind === "regular",
    price: "",
    quantity: "",
    description: "",
    sold: 0,
  }));
}

function EventModal({
  mode,
  userId,
  existing,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  userId: string;
  existing?: EventWithCounts;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [date, setDate] = useState(
    existing ? new Date(existing.date).toISOString().slice(0, 16) : "",
  );
  const [venue, setVenue] = useState(existing?.venue ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [bankEnabled, setBankEnabled] = useState(existing?.bank_transfer_enabled ?? false);
  const [bankName, setBankName] = useState(existing?.bank_name ?? "");
  const [bankAccName, setBankAccName] = useState(existing?.bank_account_name ?? "");
  const [bankAccNum, setBankAccNum] = useState(existing?.bank_account_number ?? "");
  const [orgPhone, setOrgPhone] = useState(existing?.organizer_phone ?? "");
  const [drafts, setDrafts] = useState<CategoryDraft[]>(() => {
    if (!existing) return emptyDrafts();
    const byKind = new Map(existing.categories.map((c) => [c.kind, c]));
    return KIND_ORDER.map((kind) => {
      const c = byKind.get(kind);
      return c
        ? {
            id: c.id,
            kind,
            enabled: c.enabled,
            price: String(c.price),
            quantity: String(c.quantity),
            description: c.description ?? "",
            sold: c.sold,
          }
        : {
            id: null,
            kind,
            enabled: false,
            price: "",
            quantity: "",
            description: "",
            sold: 0,
          };
    });
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function updateDraft(kind: Kind, patch: Partial<CategoryDraft>) {
    setDrafts((prev) => prev.map((d) => (d.kind === kind ? { ...d, ...patch } : d)));
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[`${kind}.price`];
      delete next[`${kind}.quantity`];
      return next;
    });
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    const enabled = drafts.filter((d) => d.enabled);
    if (enabled.length === 0) {
      setError("Enable at least one ticket category before saving.");
      return false;
    }
    for (const d of enabled) {
      const price = Number(d.price);
      const qty = Number(d.quantity);
      if (!d.price || isNaN(price) || price < 0) {
        errs[`${d.kind}.price`] = "Price is required";
      }
      if (!d.quantity || isNaN(qty) || qty < 1) {
        errs[`${d.kind}.quantity`] = "Quantity must be at least 1";
      }
      if (mode === "edit" && d.sold > 0 && qty < d.sold) {
        errs[`${d.kind}.quantity`] =
          `You cannot set the quantity below the number of tickets already sold for this category (${d.sold} sold).`;
      }
    }
    if (bankEnabled) {
      if (!bankName.trim()) errs["bank.name"] = "Required";
      if (!bankAccName.trim()) errs["bank.accName"] = "Required";
      if (!bankAccNum.trim()) errs["bank.accNum"] = "Required";
      if (!orgPhone.trim()) errs["bank.phone"] = "Required";
    }
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) {
      setError(null);
      return false;
    }
    setError(null);
    return true;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setBusy(true);
    try {
      let cover_image_url: string | null | undefined = undefined;
      if (file) {
        const ext = file.name.split(".").pop() ?? "jpg";
        const path = `${userId}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("event-covers")
          .upload(path, file, { upsert: false });
        if (upErr) throw upErr;
        const { data } = supabase.storage.from("event-covers").getPublicUrl(path);
        cover_image_url = data.publicUrl;
      }

      let eventId: string;
      const bankPayload = {
        bank_transfer_enabled: bankEnabled,
        bank_name: bankEnabled ? bankName.trim() : null,
        bank_account_name: bankEnabled ? bankAccName.trim() : null,
        bank_account_number: bankEnabled ? bankAccNum.trim() : null,
        organizer_phone: bankEnabled ? orgPhone.trim() : null,
      };
      if (mode === "create") {
        const { data: ins, error: insErr } = await supabase
          .from("events")
          .insert({
            title,
            description,
            date: new Date(date).toISOString(),
            venue,
            currency: "MUR",
            cover_image_url: cover_image_url ?? null,
            organizer_id: userId,
            ...bankPayload,
          })
          .select("id")
          .single();
        if (insErr) throw insErr;
        eventId = ins.id as string;
      } else {
        eventId = existing!.id;
        const { error: upErr } = await supabase
          .from("events")
          .update({
            title,
            description,
            date: new Date(date).toISOString(),
            venue,
            ...(cover_image_url !== undefined ? { cover_image_url } : {}),
            ...bankPayload,
          })
          .eq("id", eventId);
        if (upErr) throw upErr;
      }

      // Upsert categories
      for (const d of drafts) {
        const isNew = !d.id;
        if (isNew && !d.enabled) continue; // never created, skip
        const payload = {
          event_id: eventId,
          kind: d.kind,
          enabled: d.enabled,
          price: d.enabled ? Number(d.price) : Number(d.price || 0),
          quantity: d.enabled ? Number(d.quantity) : Math.max(1, Number(d.quantity || 1)),
          description: d.description || null,
        };
        if (isNew) {
          const { error: cErr } = await supabase.from("event_ticket_categories").insert(payload);
          if (cErr) throw cErr;
        } else {
          const { error: cErr } = await supabase
            .from("event_ticket_categories")
            .update(payload)
            .eq("id", d.id!);
          if (cErr) throw cErr;
        }
      }

      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save event");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4 animate-float-up"
      onClick={onClose}
    >
      <div
        className="glass-strong rounded-3xl p-6 md:p-8 w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">{mode === "create" ? "New event" : "Edit event"}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <Field label="Title">
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input"
              placeholder="Neon Nights vol. 7"
            />
          </Field>
          <Field label="Description">
            <textarea
              value={description ?? ""}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="input"
              placeholder="Lineup, dress code, perks…"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date & time">
              <input
                required
                type="datetime-local"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="input"
              />
            </Field>
            <Field label="Venue">
              <input
                required
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                className="input"
                placeholder="The Garage"
              />
            </Field>
          </div>
          <Field label="Cover image">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-secondary file:px-4 file:py-2 file:text-foreground"
            />
            {mode === "edit" && existing?.cover_image_url && !file && (
              <p className="text-xs text-muted-foreground mt-1">
                Current cover kept unless you choose a new file.
              </p>
            )}
          </Field>

          {/* Ticket setup */}
          <div className="pt-4 border-t border-border">
            <h3 className="text-lg font-semibold mb-1">Ticket setup</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Configure each category. Toggle off any category you don't want to offer. Prices are
              in Rs.
            </p>
            <div className="space-y-3">
              {drafts.map((d) => (
                <div
                  key={d.kind}
                  className={[
                    "rounded-2xl border p-4 transition",
                    d.enabled
                      ? "border-primary/40 bg-secondary/20"
                      : "border-border bg-secondary/10 opacity-70",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="font-semibold">{KIND_LABEL[d.kind]}</p>
                      {mode === "edit" && d.sold > 0 && (
                        <p className="text-xs text-muted-foreground">
                          {d.sold} ticket{d.sold === 1 ? "" : "s"} already sold
                        </p>
                      )}
                    </div>
                    <Toggle
                      checked={d.enabled}
                      onChange={(v) => updateDraft(d.kind, { enabled: v })}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground">Price (Rs)</label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        disabled={!d.enabled}
                        value={d.price}
                        onChange={(e) => updateDraft(d.kind, { price: e.target.value })}
                        className="input mt-1"
                        placeholder="500"
                      />
                      {fieldErrors[`${d.kind}.price`] && (
                        <p className="text-xs text-destructive mt-1">
                          {fieldErrors[`${d.kind}.price`]}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Quantity</label>
                      <input
                        type="number"
                        min={1}
                        disabled={!d.enabled}
                        value={d.quantity}
                        onChange={(e) => updateDraft(d.kind, { quantity: e.target.value })}
                        className="input mt-1"
                        placeholder="100"
                      />
                      {fieldErrors[`${d.kind}.quantity`] && (
                        <p className="text-xs text-destructive mt-1">
                          {fieldErrors[`${d.kind}.quantity`]}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="mt-3">
                    <label className="text-xs text-muted-foreground">Description</label>
                    <input
                      type="text"
                      disabled={!d.enabled}
                      value={d.description}
                      onChange={(e) => updateDraft(d.kind, { description: e.target.value })}
                      className="input mt-1"
                      placeholder="Priority entry + exclusive area access"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Payment settings — bank transfer */}
          <div className="pt-4 border-t border-border">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-semibold">Payment settings</h3>
              <Toggle checked={bankEnabled} onChange={setBankEnabled} />
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Enable bank transfer payments for this event. All four fields are required.
            </p>
            {bankEnabled && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Bank name</label>
                  <input
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    className="input mt-1"
                    placeholder="MCB"
                  />
                  {fieldErrors["bank.name"] && (
                    <p className="text-xs text-destructive mt-1">{fieldErrors["bank.name"]}</p>
                  )}
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Account name</label>
                  <input
                    value={bankAccName}
                    onChange={(e) => setBankAccName(e.target.value)}
                    className="input mt-1"
                    placeholder="Jean Dupont"
                  />
                  {fieldErrors["bank.accName"] && (
                    <p className="text-xs text-destructive mt-1">{fieldErrors["bank.accName"]}</p>
                  )}
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Account number</label>
                  <input
                    value={bankAccNum}
                    onChange={(e) => setBankAccNum(e.target.value)}
                    className="input mt-1"
                    placeholder="000123456789"
                  />
                  {fieldErrors["bank.accNum"] && (
                    <p className="text-xs text-destructive mt-1">{fieldErrors["bank.accNum"]}</p>
                  )}
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">WhatsApp / Phone</label>
                  <input
                    value={orgPhone}
                    onChange={(e) => setOrgPhone(e.target.value)}
                    className="input mt-1"
                    placeholder="+230 5453 9084"
                  />
                  {fieldErrors["bank.phone"] && (
                    <p className="text-xs text-destructive mt-1">{fieldErrors["bank.phone"]}</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {error && (
            <p className="text-sm text-destructive bg-destructive/10 px-4 py-2 rounded-lg">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-3 rounded-lg border border-border hover:bg-secondary/50 transition"
            >
              Cancel
            </button>
            <button type="submit" disabled={busy} className="btn-glow flex-1">
              {busy ? "Saving…" : mode === "create" ? "Create event" : "Save changes"}
            </button>
          </div>
        </form>
      </div>

      <style>{`
        .input {
          width: 100%;
          background: oklch(0.25 0.04 290 / 0.6);
          border: 1px solid oklch(0.3 0.04 290 / 0.5);
          border-radius: 0.5rem;
          padding: 0.65rem 0.85rem;
          color: oklch(0.98 0.005 290);
          outline: none;
          font-size: 0.95rem;
        }
        .input:focus { border-color: oklch(0.65 0.28 305); box-shadow: 0 0 0 2px oklch(0.65 0.28 305 / 0.3); }
        .input:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={[
        "relative inline-flex h-6 w-11 items-center rounded-full transition",
        checked ? "bg-primary" : "bg-secondary",
      ].join(" ")}
    >
      <span
        className={[
          "inline-block h-5 w-5 rounded-full bg-white transition",
          checked ? "translate-x-5" : "translate-x-0.5",
        ].join(" ")}
      />
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}
