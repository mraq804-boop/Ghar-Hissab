"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ledger/field";
import { changePassword } from "../actions";

export function PasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <form
      className="space-y-4 rounded-2xl border bg-card p-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await changePassword({ password, confirm });
          if (r.ok) {
            toast.success(r.message);
            router.push("/dashboard");
          } else {
            setErrors(Object.fromEntries(Object.entries(r.fieldErrors ?? {}).map(([k, v]) => [k, v[0]])));
            if (!r.fieldErrors) toast.error(r.error);
          }
        });
      }}
    >
      <Field label="New password" htmlFor="password" error={errors.password} hint="At least 10 characters">
        <Input id="password" type="password" autoComplete="new-password" className="h-11" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label="Type it again" htmlFor="confirm" error={errors.confirm}>
        <Input id="confirm" type="password" autoComplete="new-password" className="h-11" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      <Button type="submit" className="h-11 w-full" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : null} Save password</Button>
    </form>
  );
}
