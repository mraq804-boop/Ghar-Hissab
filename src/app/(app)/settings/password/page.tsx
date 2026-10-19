import type { Metadata } from "next";
import { PageHeader } from "@/components/ledger/page-header";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Password" };

export default function PasswordPage() {
  return (
    <div className="mx-auto max-w-md">
      <PageHeader title="Set your password" description="Use it with your email address to sign in. You can also keep using emailed sign-in links." />
      <PasswordForm />
    </div>
  );
}
