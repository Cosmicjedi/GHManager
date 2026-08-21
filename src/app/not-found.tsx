import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-canvas px-6 text-center">
      <h1 className="text-lg font-semibold text-fg">Page not found</h1>
      <p className="text-sm text-fg-muted">GHManager only has one screen: the dashboard.</p>
      <Link href="/" className="text-sm font-medium text-accent underline underline-offset-2">
        Back to the dashboard
      </Link>
    </div>
  );
}
