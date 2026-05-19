
-- Events table
CREATE TABLE public.events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  date TIMESTAMPTZ NOT NULL,
  venue TEXT NOT NULL,
  ticket_price NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'NGN',
  cover_image_url TEXT,
  organizer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tickets table
CREATE TABLE public.tickets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  attendee_name TEXT NOT NULL,
  attendee_email TEXT NOT NULL,
  payment_reference TEXT,
  payment_status TEXT NOT NULL DEFAULT 'pending',
  checked_in BOOLEAN NOT NULL DEFAULT false,
  checked_in_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_events_organizer ON public.events(organizer_id);
CREATE INDEX idx_tickets_event ON public.tickets(event_id);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

-- Events: public read (so attendees can see event landing pages), organizers manage their own
CREATE POLICY "Events are viewable by everyone"
  ON public.events FOR SELECT
  USING (true);

CREATE POLICY "Organizers can insert their own events"
  ON public.events FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = organizer_id);

CREATE POLICY "Organizers can update their own events"
  ON public.events FOR UPDATE
  TO authenticated
  USING (auth.uid() = organizer_id);

CREATE POLICY "Organizers can delete their own events"
  ON public.events FOR DELETE
  TO authenticated
  USING (auth.uid() = organizer_id);

-- Tickets: 
-- Anyone can insert a ticket (purchase). Server validates payment.
-- Anyone can read a ticket by id (used to show ticket page after purchase).
-- Organizers can read/update tickets for their events (for scanning + dashboard).
CREATE POLICY "Anyone can create a ticket"
  ON public.tickets FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Tickets are viewable by everyone"
  ON public.tickets FOR SELECT
  USING (true);

CREATE POLICY "Organizers can update tickets for their events"
  ON public.tickets FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = tickets.event_id AND e.organizer_id = auth.uid()
    )
  );

-- Storage bucket for event cover images
INSERT INTO storage.buckets (id, name, public) VALUES ('event-covers', 'event-covers', true);

CREATE POLICY "Event covers are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'event-covers');

CREATE POLICY "Authenticated users can upload event covers"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'event-covers');

CREATE POLICY "Users can update their own event covers"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'event-covers' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own event covers"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'event-covers' AND auth.uid()::text = (storage.foldername(name))[1]);
