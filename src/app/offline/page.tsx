import type { Metadata } from "next";
import { WifiOff } from "lucide-react";
import { RetryButton } from "./retry-button";

export const metadata: Metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="max-w-sm text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-accent text-accent-foreground">
          <WifiOff className="size-7" />
        </span>
        <h1 className="mt-5 font-heading text-2xl font-bold">You&apos;re offline</h1>
        <p className="mt-2 text-muted-foreground">
          Ghar Hisaab needs the internet to show the family accounts. Nothing is stored on this phone, so your records are safe on the server.
        </p>
        <RetryButton />
      </div>
    </main>
  );
}
