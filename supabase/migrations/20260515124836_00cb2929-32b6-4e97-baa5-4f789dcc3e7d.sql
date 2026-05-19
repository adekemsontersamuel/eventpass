
-- Ticket categories (Early Bird / Regular / VIP) per event
CREATE TYPE public.ticket_category_kind AS ENUM ('early_bird', 'regular', 'vip');

CREATE TABLE public.event_ticket_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  kind public.ticket_category_kind NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  price numeric NOT NULL CHECK (price >= 0),
  quantity integer NOT NULL CHECK (quantity >= 1),
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, kind)
);

ALTER TABLE public.event_ticket_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Categories are viewable by everyone"
  ON public.event_ticket_categories FOR SELECT
  USING (true);

CREATE POLICY "Organizers manage their own categories - insert"
  ON public.event_ticket_categories FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_ticket_categories.event_id
      AND e.organizer_id = auth.uid()
  ));

CREATE POLICY "Organizers manage their own categories - update"
  ON public.event_ticket_categories FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_ticket_categories.event_id
      AND e.organizer_id = auth.uid()
  ));

CREATE POLICY "Organizers manage their own categories - delete"
  ON public.event_ticket_categories FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_ticket_categories.event_id
      AND e.organizer_id = auth.uid()
  ));

-- Add category + amount_paid to tickets
ALTER TABLE public.tickets
  ADD COLUMN category_id uuid REFERENCES public.event_ticket_categories(id) ON DELETE RESTRICT,
  ADD COLUMN amount_paid numeric;

-- Backfill: create one 'regular' category per existing event from current ticket_price
INSERT INTO public.event_ticket_categories (event_id, kind, enabled, price, quantity, description)
SELECT id, 'regular', true, COALESCE(ticket_price, 0), 1000, NULL
FROM public.events;

-- Link existing tickets to their event's regular category
UPDATE public.tickets t
SET category_id = c.id,
    amount_paid = COALESCE((SELECT ticket_price FROM public.events WHERE id = t.event_id), 0)
FROM public.event_ticket_categories c
WHERE c.event_id = t.event_id AND c.kind = 'regular' AND t.category_id IS NULL;

-- Default currency for new events: MUR
ALTER TABLE public.events ALTER COLUMN currency SET DEFAULT 'MUR';

-- Drop legacy single-price column
ALTER TABLE public.events DROP COLUMN ticket_price;
