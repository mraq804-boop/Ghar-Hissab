import { signOut } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";

export default function NoAccessPage() {
  return (
    <main className="grid min-h-dvh place-items-center px-5">
      <div className="max-w-md text-center">
        <h1 className="font-heading text-3xl font-bold">You&apos;re signed in, but not part of a household yet</h1>
        <p className="mt-3 text-muted-foreground">
          Ask the family administrator to invite this email address from the Family page. Once they do, sign in again.
        </p>
        <form action={signOut} className="mt-6">
          <Button type="submit" variant="outline">Sign out</Button>
        </form>
      </div>
    </main>
  );
}
