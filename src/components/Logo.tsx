import { Link } from "@tanstack/react-router";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link
      to="/"
      className={`inline-flex items-center gap-2 font-display font-bold text-xl tracking-tight ${className}`}
    >
      <span className="relative flex h-8 w-8 items-center justify-center rounded-lg gradient-primary text-white">
        <span className="text-sm">★</span>
        <span className="absolute inset-0 rounded-lg blur-md gradient-primary opacity-60 -z-10" />
      </span>
      <span>
        Party<span className="gradient-text">Pass</span>
      </span>
    </Link>
  );
}
