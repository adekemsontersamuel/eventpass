
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS bank_name TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_name TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_number TEXT,
  ADD COLUMN IF NOT EXISTS organizer_phone TEXT,
  ADD COLUMN IF NOT EXISTS bank_transfer_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'card';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tickets_payment_method_check'
  ) THEN
    ALTER TABLE public.tickets
      ADD CONSTRAINT tickets_payment_method_check
      CHECK (payment_method IN ('card', 'bank_transfer'));
  END IF;
END $$;
