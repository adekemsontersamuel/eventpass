# PartyPass

Event ticketing app: organizers create events with tiered ticket categories (Early Bird, Regular, VIP), attendees pay via Flutterwave (MUR / Rs) and receive a QR pass that organizers scan at the door for check-in.

Built with **TanStack Start** (React 19 + Vite 7), **Tailwind CSS v4**, **shadcn/ui**, and **Supabase** (Postgres + Auth + Storage) for the backend.

---

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Bun](https://bun.sh/) (used as the package manager)
- [VS Code](https://code.visualstudio.com/) — recommended IDE
- A [Supabase](https://supabase.com/) account (free tier is fine)
- A [Flutterwave](https://flutterwave.com/) account for test API keys (optional — only needed for the payment flow)

### Recommended VS Code extensions

- **ESLint** (`dbaeumer.vscode-eslint`)
- **Prettier** (`esbenp.prettier-vscode`)
- **Tailwind CSS IntelliSense** (`bradlc.vscode-tailwindcss`)

---

## 1. Clone & install

```bash
git clone <your-repo-url> partypass
cd partypass
bun install
```

Open the project in VS Code:

```bash
code .
```

---

## 2. Connect Supabase

### a. Create a Supabase project

1. Go to <https://supabase.com/dashboard> → **New project**.
2. Pick a name, region, and a strong database password.
3. Wait for the project to finish provisioning.

### b. Grab your keys

In the Supabase dashboard, open **Project Settings → API**, and copy:

- **Project URL** → `https://<project-ref>.supabase.co`
- **`anon` public key** (publishable)
- **`service_role` key** (server-only, never ship to the browser)

You'll also need the **project ref** (the `<project-ref>` part of the URL) for the CLI.

### c. Create `.env` at the project root

```env
# Client (exposed to the browser via Vite)
VITE_SUPABASE_URL="https://<project-ref>.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="<anon-key>"
VITE_SUPABASE_PROJECT_ID="<project-ref>"

# Server (used by TanStack server functions)
SUPABASE_URL="https://<project-ref>.supabase.co"
SUPABASE_PUBLISHABLE_KEY="<anon-key>"
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"

# Flutterwave (test keys for local dev)
FLW_PUBLIC_KEY="FLWPUBK_TEST-xxxxxxxx"
FLW_SECRET_KEY="FLWSECK_TEST-xxxxxxxx"
```

> ⚠️ Never commit `.env` or expose `SUPABASE_SERVICE_ROLE_KEY` / `FLW_SECRET_KEY` to the client.

---

## 3. Run the database migrations

The schema lives in `supabase/migrations/`. Apply it with the Supabase CLI.

### Install the CLI

```bash
# macOS
brew install supabase/tap/supabase

# Windows (Scoop)
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase

# or via npm (any OS)
npm install -g supabase
```

### Link & push migrations

```bash
supabase login
supabase link --project-ref <project-ref>
supabase db push
```

This applies every file in `supabase/migrations/` to your remote Supabase database in order. Re-run `supabase db push` whenever you add new migrations.

### Create a storage bucket

In the Supabase dashboard go to **Storage → New bucket**, name it `event-covers`, and mark it **Public** (used for event cover images).

---

## 4. Run the app

```bash
bun run dev
```

The app starts at <http://localhost:8080> (or the port printed in the terminal). Edits hot-reload automatically.

### Other useful scripts

```bash
bun run build      # production build
bun run preview    # preview the production build locally
bun run lint       # ESLint
bun run format     # Prettier
```

---

## Project structure

```
src/
├── routes/                 # File-based routes (TanStack Router)
│   ├── __root.tsx          # Root layout
│   ├── index.tsx           # Home / event listing
│   ├── event.$eventId.tsx  # Public event + ticket purchase
│   ├── ticket.$ticketId.tsx
│   ├── organizer.dashboard.tsx
│   ├── organizer.login.tsx
│   └── organizer.scan.$eventId.tsx
├── lib/
│   ├── payment.functions.ts   # Server functions (Flutterwave verify, check-in)
│   └── flutterwave.ts
├── integrations/supabase/     # Auto-generated Supabase clients & types — do not edit
└── components/ui/             # shadcn/ui components

supabase/
├── migrations/                # SQL migrations
└── config.toml
```

---

## Troubleshooting

- **`Missing Supabase environment variable(s)`** — your `.env` is missing or VS Code hasn't picked it up. Restart the dev server after editing `.env`.
- **Payments fail with "Payment provider not configured"** — `FLW_SECRET_KEY` is missing from `.env`.
- **Migration errors on `db push`** — make sure the project is linked (`supabase link --project-ref ...`) and that you have no conflicting tables in the remote DB.
- **`Unauthorized` from a server function** — sign in first; protected server functions require an authenticated Supabase session.

---

## License

Private project. All rights reserved.
