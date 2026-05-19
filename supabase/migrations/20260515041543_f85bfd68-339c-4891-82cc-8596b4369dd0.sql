ALTER TABLE public.tickets DROP CONSTRAINT tickets_event_id_fkey;
ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

CREATE POLICY "Organizers can delete tickets for their events"
ON public.tickets
FOR DELETE
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.events e
  WHERE e.id = tickets.event_id AND e.organizer_id = auth.uid()
));
