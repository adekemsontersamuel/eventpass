import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getFlutterwavePublicKey = createServerFn({ method: "GET" }).handler(async () => {
  return { publicKey: process.env.FLW_PUBLIC_KEY ?? "" };
});

async function assertCategoryAvailable(categoryId: string, eventId: string) {
  const { data: category, error: catErr } = await supabaseAdmin
    .from("event_ticket_categories")
    .select("id, event_id, enabled, price, quantity")
    .eq("id", categoryId)
    .maybeSingle();
  if (catErr) throw new Error(catErr.message);
  if (!category || category.event_id !== eventId || !category.enabled) {
    throw new Error("Invalid ticket category");
  }

  const { count: soldCount, error: countErr } = await supabaseAdmin
    .from("tickets")
    .select("id", { count: "exact", head: true })
    .eq("category_id", category.id)
    .eq("payment_status", "paid");
  if (countErr) throw new Error(countErr.message);
  if ((soldCount ?? 0) >= category.quantity) {
    throw new Error("Sorry, this ticket category is now sold out.");
  }
  return category;
}

const KIND_LABEL: Record<"early_bird" | "regular" | "vip", string> = {
  early_bird: "Early Bird",
  regular: "Regular",
  vip: "VIP",
};

function formatDateForEmail(date: string) {
  return new Date(date).toLocaleString("en-US", {
    dateStyle: "long",
    timeStyle: "short",
  });
}

async function sendResendEmail({
  to,
  subject,
  html,
  text,
}: {
  to: string;
  subject: string;
  html: string;
  text: string;
}) {
  const key =
    typeof globalThis !== "undefined" && "Deno" in globalThis
      ? (globalThis as any).Deno.env.get("RESEND_API_KEY")
      : process.env.RESEND_API_KEY;
  console.log("RESEND_KEY present:", !!key);

  if (!key) throw new Error("Resend email key not configured");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "PartyPass <tickets@cityhackz.com.ng>",
      to: [to],
      subject,
      html,
      text,
    }),
  });

  const data = await res.json().catch((err) => {
    console.error("Resend parse error:", err);
    return null;
  });

  if (!res.ok) {
    console.error("Resend error:", JSON.stringify(data));
    throw new Error(data?.error?.message || "Resend email failed");
  }

  return data;
}

async function sendTicketDecisionEmail({
  ticketId,
  attendeeName,
  attendeeEmail,
  paymentReference,
  categoryLabel,
  eventTitle,
  eventDate,
  eventVenue,
  organizerPhone,
  decision,
}: {
  ticketId: string;
  attendeeName: string;
  attendeeEmail: string;
  paymentReference: string | null;
  categoryLabel: string;
  eventTitle: string;
  eventDate: string;
  eventVenue: string;
  organizerPhone: string | null;
  decision: "approve" | "reject";
}) {
  const appUrl = process.env.APP_URL?.replace(/\/$/, "") ?? "";
  if (!appUrl) {
    throw new Error("Application URL not configured for email links");
  }

  if (decision === "approve") {
    const subject = `Your ${eventTitle} ticket is confirmed 🎟`;
    const ticketUrl = `${appUrl}/ticket/${ticketId}`;
    const html = `
      <p>Hi ${attendeeName},</p>
      <p>Your ticket for <strong>${eventTitle}</strong> is confirmed.</p>
      <ul>
        <li><strong>Date:</strong> ${eventDate}</li>
        <li><strong>Venue:</strong> ${eventVenue}</li>
        <li><strong>Ticket category:</strong> ${categoryLabel}</li>
        <li><strong>Payment reference:</strong> ${paymentReference ?? "N/A"}</li>
      </ul>
      <p>
        <a href="${ticketUrl}" style="display:inline-block;padding:12px 18px;margin:12px 0;background:#111827;color:#ffffff;text-decoration:none;border-radius:6px;">
          View & Download Your Ticket
        </a>
      </p>
      <p>Thank you for booking with us.</p>
    `;
    const text = `Hi ${attendeeName},

Your ticket for ${eventTitle} is confirmed.

Date: ${eventDate}
Venue: ${eventVenue}
Ticket category: ${categoryLabel}
Payment reference: ${paymentReference ?? "N/A"}

View & Download Your Ticket: ${ticketUrl}

Thank you for booking with us.`;
    await sendResendEmail({ to: attendeeEmail, subject, html, text });
    return;
  }

  const subject = `Regarding your ticket request for ${eventTitle}`;
  const organizerContact = organizerPhone
    ? `Please contact the organizer directly via WhatsApp at ${organizerPhone}.`
    : "Please contact the organizer directly for next steps.";
  const html = `
    <p>Hi ${attendeeName},</p>
    <p>We were unable to confirm the payment for your ticket request for <strong>${eventTitle}</strong>.</p>
    <p>${organizerContact}</p>
    <p>We apologize for the inconvenience and appreciate your patience.</p>
  `;
  const text = `Hi ${attendeeName},

We were unable to confirm the payment for your ticket request for ${eventTitle}.

${organizerContact}

We apologize for the inconvenience and appreciate your patience.`;
  await sendResendEmail({ to: attendeeEmail, subject, html, text });
}

export const verifyAndCreateTicket = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        transactionId: z.union([z.string(), z.number()]).transform((v) => String(v)),
        eventId: z.string().uuid(),
        categoryId: z.string().uuid(),
        attendeeName: z.string().min(1).max(120),
        attendeeEmail: z.string().email().max(255),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const secret = process.env.FLW_SECRET_KEY;
    if (!secret) throw new Error("Payment provider not configured");

    const category = await assertCategoryAvailable(data.categoryId, data.eventId);

    const res = await fetch(
      `https://api.flutterwave.com/v3/transactions/${data.transactionId}/verify`,
      { headers: { Authorization: `Bearer ${secret}` } },
    );
    if (!res.ok) throw new Error("Payment verification failed");
    const json = (await res.json()) as {
      status: string;
      data?: { status: string; amount: number; currency: string; tx_ref?: string };
    };

    const expected = Number(category.price);
    if (
      json.status !== "success" ||
      !json.data ||
      json.data.status !== "successful" ||
      json.data.amount < expected
    ) {
      throw new Error("Payment not successful");
    }

    const { data: ticket, error } = await supabaseAdmin
      .from("tickets")
      .insert({
        event_id: data.eventId,
        category_id: category.id,
        attendee_name: data.attendeeName,
        attendee_email: data.attendeeEmail,
        payment_reference: String(data.transactionId),
        payment_status: "paid",
        payment_method: "card",
        amount_paid: expected,
      })
      .select("id")
      .single();

    if (error || !ticket) throw new Error(error?.message ?? "Could not create ticket");
    return { ticketId: ticket.id };
  });

function makeBankReference(firstName: string) {
  const clean =
    (firstName || "GUEST")
      .toUpperCase()
      .replace(/[^A-Z]/g, "")
      .slice(0, 10) || "GUEST";
  const digits = Math.floor(1000 + Math.random() * 9000);
  return `PP-${clean}-${digits}`;
}

export const createBankTransferTicket = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        eventId: z.string().uuid(),
        categoryId: z.string().uuid(),
        attendeeName: z.string().min(1).max(120),
        attendeeEmail: z.string().email().max(255),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    // Verify event has bank transfer enabled
    const { data: event, error: evErr } = await supabaseAdmin
      .from("events")
      .select("id, bank_transfer_enabled")
      .eq("id", data.eventId)
      .maybeSingle();
    if (evErr) throw new Error(evErr.message);
    if (!event || !event.bank_transfer_enabled) {
      throw new Error("Bank transfer is not enabled for this event.");
    }

    const category = await assertCategoryAvailable(data.categoryId, data.eventId);

    const firstName = data.attendeeName.trim().split(/\s+/)[0] ?? "GUEST";
    const reference = makeBankReference(firstName);

    const { data: ticket, error } = await supabaseAdmin
      .from("tickets")
      .insert({
        event_id: data.eventId,
        category_id: category.id,
        attendee_name: data.attendeeName,
        attendee_email: data.attendeeEmail,
        payment_reference: reference,
        payment_status: "pending",
        payment_method: "bank_transfer",
        amount_paid: Number(category.price),
      })
      .select("id")
      .single();

    if (error || !ticket) throw new Error(error?.message ?? "Could not create ticket");
    return { ticketId: ticket.id, reference, amount: Number(category.price) };
  });

export const decidePendingTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        ticketId: z.string().uuid(),
        decision: z.enum(["approve", "reject"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;

    // Load ticket + event to confirm ownership
    const { data: ticket, error: tErr } = await supabaseAdmin
      .from("tickets")
      .select(
        "id, event_id, payment_status, payment_method, attendee_email, category_id, attendee_name, payment_reference",
      )
      .eq("id", data.ticketId)
      .maybeSingle();
    if (tErr) throw new Error(tErr.message);
    if (!ticket) throw new Error("Ticket not found");
    if (ticket.payment_method !== "bank_transfer" || ticket.payment_status !== "pending") {
      throw new Error("Ticket is not awaiting approval.");
    }
    if (!ticket.category_id) {
      throw new Error("Ticket category is missing.");
    }

    const { data: ev, error: eErr } = await supabaseAdmin
      .from("events")
      .select("id, organizer_id")
      .eq("id", ticket.event_id)
      .maybeSingle();
    if (eErr) throw new Error(eErr.message);
    if (!ev || ev.organizer_id !== userId) {
      throw new Error("Not authorized");
    }

    const newStatus = data.decision === "approve" ? "paid" : "rejected";

    const { data: event, error: eventErr } = await supabaseAdmin
      .from("events")
      .select("id,title,date,venue,organizer_phone")
      .eq("id", ticket.event_id)
      .maybeSingle();
    if (eventErr) throw new Error(eventErr.message);
    if (!event) throw new Error("Event not found");

    const { data: category, error: categoryErr } = await supabaseAdmin
      .from("event_ticket_categories")
      .select("kind")
      .eq("id", ticket.category_id)
      .maybeSingle();
    if (categoryErr) throw new Error(categoryErr.message);

    const categoryLabel = category
      ? (KIND_LABEL[category.kind as keyof typeof KIND_LABEL] ?? "Ticket")
      : "Ticket";

    try {
      if (data.decision === "approve") {
        await sendTicketDecisionEmail({
          ticketId: ticket.id,
          attendeeName: ticket.attendee_name,
          attendeeEmail: ticket.attendee_email,
          paymentReference: ticket.payment_reference,
          categoryLabel,
          eventTitle: event.title,
          eventDate: formatDateForEmail(event.date),
          eventVenue: event.venue,
          organizerPhone: event.organizer_phone,
          decision: "approve",
        });
      } else {
        await sendTicketDecisionEmail({
          ticketId: ticket.id,
          attendeeName: ticket.attendee_name,
          attendeeEmail: ticket.attendee_email,
          paymentReference: ticket.payment_reference,
          categoryLabel,
          eventTitle: event.title,
          eventDate: formatDateForEmail(event.date),
          eventVenue: event.venue,
          organizerPhone: event.organizer_phone,
          decision: "reject",
        });
      }

      const { error: upErr } = await supabaseAdmin
        .from("tickets")
        .update({ payment_status: newStatus })
        .eq("id", ticket.id);
      if (upErr) throw new Error(upErr.message);
    } catch (emailError) {
      console.error("Ticket decision email failed:", emailError);
      throw new Error(
        emailError instanceof Error ? emailError.message : "Failed to send notification email",
      );
    }

    return { ok: true, status: newStatus };
  });

export const checkInTicket = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ ticketId: z.string().uuid(), eventId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { data: ticket, error } = await supabaseAdmin
      .from("tickets")
      .select("id, event_id, attendee_name, payment_status, checked_in, checked_in_at")
      .eq("id", data.ticketId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!ticket || ticket.event_id !== data.eventId) {
      return { result: "invalid" as const };
    }
    if (ticket.payment_status !== "paid") {
      return { result: "invalid" as const };
    }
    if (ticket.checked_in) {
      return {
        result: "already" as const,
        attendeeName: ticket.attendee_name,
        checkedInAt: ticket.checked_in_at,
      };
    }

    const now = new Date().toISOString();
    const { error: upErr } = await supabaseAdmin
      .from("tickets")
      .update({ checked_in: true, checked_in_at: now })
      .eq("id", data.ticketId);
    if (upErr) throw new Error(upErr.message);

    return { result: "ok" as const, attendeeName: ticket.attendee_name };
  });
