import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Logo";

export const Route = createFileRoute("/organizer/login")({
  component: OrganizerLogin,
});

function OrganizerLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/organizer/dashboard" });
    });
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/organizer/dashboard` },
        });
        if (error) throw error;
      }
      navigate({ to: "/organizer/dashboard" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="p-6 md:px-10 flex justify-between items-center">
        <Logo />
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-md glass-strong rounded-3xl p-8 md:p-10 animate-float-up">
          <p className="text-xs uppercase tracking-[0.3em] text-accent">Organizer Portal</p>
          <h1 className="text-3xl font-bold mt-2">
            {mode === "login" ? "Welcome back." : "Create account"}
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            {mode === "login"
              ? "Sign in to manage your events and scan tickets."
              : "Spin up an account to start selling tickets."}
          </p>

          <form onSubmit={submit} className="mt-8 space-y-4">
            <div>
              <label className="text-sm text-muted-foreground">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full mt-1 bg-input/60 border border-border rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Password</label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full mt-1 bg-input/60 border border-border rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            {error && (
              <p className="text-sm text-destructive bg-destructive/10 px-4 py-2 rounded-lg">
                {error}
              </p>
            )}
            <button type="submit" disabled={busy} className="btn-glow w-full">
              {busy ? "…" : mode === "login" ? "Sign in" : "Create account"}
            </button>
          </form>

          <button
            onClick={() => setMode(mode === "login" ? "signup" : "login")}
            className="mt-6 text-sm text-muted-foreground hover:text-foreground w-full text-center"
          >
            {mode === "login"
              ? "No account? Create one →"
              : "Already have an account? Sign in →"}
          </button>
        </div>
      </main>
    </div>
  );
}
