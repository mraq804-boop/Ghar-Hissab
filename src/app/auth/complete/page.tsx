import { Suspense } from "react";
import { CompleteSignIn } from "./complete-sign-in";

export default function CompletePage() {
  return (
    <main className="grid min-h-dvh place-items-center px-5">
      <Suspense fallback={<p className="text-muted-foreground">Signing you in…</p>}>
        <CompleteSignIn />
      </Suspense>
    </main>
  );
}
