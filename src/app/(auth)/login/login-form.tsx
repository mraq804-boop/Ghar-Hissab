"use client";

import { useActionState, useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { sendSignInLink, signInWithPassword } from "../actions";

const ERRORS: Record<string, string> = {
  link: "That sign-in link has expired or was already used. Ask for a new one.",
};

export function LoginForm({ next, initialError }: { next: string; initialError?: string }) {
  const [pwState, pwAction, pwPending] = useActionState(signInWithPassword, undefined);
  const [linkState, linkAction, linkPending] = useActionState(sendSignInLink, undefined);
  const [email, setEmail] = useState("");

  return (
    <Tabs defaultValue="password" className="mt-8">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="password">Password</TabsTrigger>
        <TabsTrigger value="link">Email me a link</TabsTrigger>
      </TabsList>

      {initialError && ERRORS[initialError] ? (
        <p role="alert" className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-destructive">
          {ERRORS[initialError]}
        </p>
      ) : null}

      <TabsContent value="password">
        <form action={pwAction} className="mt-4 space-y-4">
          <input type="hidden" name="next" value={next} />
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" required minLength={8} className="h-11" />
          </div>
          {pwState?.error ? (
            <p role="alert" className="text-sm text-destructive">{pwState.error}</p>
          ) : null}
          <Button type="submit" className="h-11 w-full text-[15px]" disabled={pwPending}>
            {pwPending ? <Loader2 className="animate-spin" /> : null}
            Sign in
          </Button>
        </form>
      </TabsContent>

      <TabsContent value="link">
        <form action={linkAction} className="mt-4 space-y-4">
          <input type="hidden" name="next" value={next} />
          <div className="space-y-1.5">
            <Label htmlFor="link-email">Email</Label>
            <Input id="link-email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" />
          </div>
          {linkState?.error ? <p role="alert" className="text-sm text-destructive">{linkState.error}</p> : null}
          {linkState?.sent ? (
            <p role="status" className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success">{linkState.sent}</p>
          ) : null}
          <Button type="submit" variant="outline" className="h-11 w-full text-[15px]" disabled={linkPending}>
            {linkPending ? <Loader2 className="animate-spin" /> : <Mail />}
            Send sign-in link
          </Button>
        </form>
      </TabsContent>

      <p className="mt-8 text-sm text-muted-foreground">
        No account? Accounts are invite-only. Ask the family administrator to add you.
      </p>
    </Tabs>
  );
}
