
DROP POLICY "Anyone can create a ticket" ON public.tickets;

CREATE POLICY "Anyone can create a pending ticket for an existing event"
  ON public.tickets FOR INSERT
  WITH CHECK (
    payment_status = 'pending'
    AND EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id)
  );

DROP POLICY "Event covers are publicly readable" ON storage.objects;
