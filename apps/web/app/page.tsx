import { env } from "@/lib/env";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-6">
      <h1 className="text-2xl font-semibold text-ink">Insurix</h1>
      <p className="text-ink">
        Repo scaffold is up. Environment validated for{" "}
        <span className="font-mono">{env.NODE_ENV}</span>. No product features are
        implemented yet — see <span className="font-mono">insurix-build-spec.md</span>{" "}
        section 11 for build order.
      </p>
    </main>
  );
}
