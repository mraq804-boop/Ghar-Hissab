"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Mail, MoreHorizontal, Pencil, Phone, Plus, ShieldCheck, ShieldOff, UserCheck, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Field } from "@/components/ledger/field";
import { Money } from "@/components/ledger/money";
import { PageHeader, Panel } from "@/components/ledger/page-header";
import { ResponsiveDialog } from "@/components/ledger/responsive-dialog";
import { StatusBadge } from "@/components/ledger/status-badge";
import { cn } from "@/lib/utils";
import { inviteMember, saveMember, setMemberActive, setMemberRole } from "./actions";

export type MemberView = {
  id: string;
  unitId: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  relation: string | null;
  dutyLabel: string | null;
  joinedOn: string;
  active: boolean;
  hasAccount: boolean;
  role: "admin" | "member" | null;
  invited: boolean;
  isMe: boolean;
};

export type UnitHistory = {
  unitId: string;
  code: string;
  rows: { slug: string; label: string; sharePaisa: bigint; paidPaisa: bigint; balancePaisa: bigint; status: string; pending: number }[];
};

type Unit = { id: string; code: string; name: string; isPurseHolder: boolean };

export function FamilyBoard({ admin, units, members, history }: { admin: boolean; units: Unit[]; members: MemberView[]; history: UnitHistory[] }) {
  const [editing, setEditing] = useState<MemberView | { unitId: string } | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const router = useRouter();
  const inactiveCount = members.filter((m) => !m.active).length;

  return (
    <>
      <PageHeader
        title="Family"
        description={`${members.filter((m) => m.active).length} people across ${units.length} households. Shares are divided by household.`}
        actions={
          <>
            {inactiveCount ? (
              <Button variant="outline" onClick={() => setShowInactive((s) => !s)}>{showInactive ? "Hide" : "Show"} {inactiveCount} inactive</Button>
            ) : null}
            {admin ? <Button onClick={() => setEditing({ unitId: units[0]?.id ?? "" })}><Plus /> Add member</Button> : null}
          </>
        }
      />

      <div className="grid gap-5 md:grid-cols-3">
        {units.map((u) => {
          const list = members.filter((m) => m.unitId === u.id && (showInactive || m.active));
          return (
            <section key={u.id} className="rounded-2xl border bg-card" aria-labelledby={`unit-${u.id}`}>
              <header className="flex items-center justify-between border-b px-5 py-4">
                <div>
                  <h2 id={`unit-${u.id}`} className="font-heading text-2xl font-extrabold">{u.code}</h2>
                  <p className="text-xs text-muted-foreground">{u.isPurseHolder ? "Holds the household purse" : `${list.filter((m) => m.active).length} people`}</p>
                </div>
                {admin ? (
                  <Button variant="ghost" size="sm" onClick={() => setEditing({ unitId: u.id })} aria-label={`Add member to ${u.code}`}><Plus /> Add</Button>
                ) : null}
              </header>
              {list.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-muted-foreground">No members recorded yet.</p>
              ) : (
                <ul className="divide-y">
                  {list.map((m) => (
                    <li key={m.id} className={cn("flex items-start gap-3 px-5 py-3", !m.active && "opacity-60")}>
                      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">
                        {m.fullName.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                          {m.fullName}
                          {m.isMe ? <span className="text-xs font-normal text-muted-foreground">(you)</span> : null}
                          {m.role === "admin" ? <span className="rounded-full bg-accent px-1.5 text-[11px] text-accent-foreground">Admin</span> : null}
                          {m.dutyLabel ? <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">{m.dutyLabel}</span> : null}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[m.relation, !m.active ? "Inactive" : m.hasAccount ? "Has an account" : m.invited ? "Invitation sent" : null].filter(Boolean).join(", ") || " "}
                        </p>
                        {m.phone || m.email ? (
                          <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                            {m.phone ? <a href={`tel:${m.phone}`} className="inline-flex items-center gap-1 hover:text-foreground"><Phone className="size-3" />{m.phone}</a> : null}
                            {m.email ? <a href={`mailto:${m.email}`} className="inline-flex max-w-full items-center gap-1 truncate hover:text-foreground"><Mail className="size-3" />{m.email}</a> : null}
                          </p>
                        ) : null}
                      </div>
                      {admin ? <MemberMenu m={m} onEdit={() => setEditing(m)} onChanged={() => router.refresh()} /> : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {history.length ? (
        <Panel className="mt-6" title="Contribution history" description="Share, approved payments and balance for every month" bodyClassName="p-0">
          <Tabs defaultValue={history[0].unitId}>
            {history.length > 1 ? (
              <TabsList className="mx-5 mt-4">
                {history.map((h) => <TabsTrigger key={h.unitId} value={h.unitId}>{h.code}</TabsTrigger>)}
              </TabsList>
            ) : null}
            {history.map((h) => (
              <TabsContent key={h.unitId} value={h.unitId} className="mt-2">
                <div className="overflow-x-auto">
                  <table className="num w-full min-w-[32rem] text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="px-5 py-2 font-medium">Month</th>
                        <th className="px-3 py-2 text-right font-medium">Share</th>
                        <th className="px-3 py-2 text-right font-medium">Paid</th>
                        <th className="px-3 py-2 text-right font-medium">Balance</th>
                        <th className="px-5 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {h.rows.map((r) => (
                        <tr key={r.slug}>
                          <td className="px-5 py-2.5"><Link className="hover:underline" href={`/payments?m=${r.slug}&unit=${h.code}`}>{r.label}</Link></td>
                          <td className="px-3 py-2.5 text-right"><Money paisa={r.sharePaisa} /></td>
                          <td className="px-3 py-2.5 text-right"><Money paisa={r.paidPaisa} /></td>
                          <td className="px-3 py-2.5 text-right"><Money paisa={r.balancePaisa} signed tone="auto" /></td>
                          <td className="px-5 py-2.5">
                            <span className="flex items-center gap-2">
                              <StatusBadge status={r.status} compact={false} />
                              {r.pending ? <span className="text-xs text-warning">{r.pending} pending</span> : null}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </Panel>
      ) : null}

      <ResponsiveDialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={editing && "id" in editing ? "Edit member" : "Add member"}>
        {editing ? (
          <MemberForm
            units={units}
            initial={"id" in editing ? editing : { unitId: editing.unitId }}
            onDone={() => {
              setEditing(null);
              router.refresh();
            }}
          />
        ) : null}
      </ResponsiveDialog>
    </>
  );
}

function MemberMenu({ m, onEdit, onChanged }: { m: MemberView; onEdit: () => void; onChanged: () => void }) {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message);
      else toast.error(r.error);
      onChanged();
    });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${m.fullName}`} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onEdit}><Pencil /> Edit details</DropdownMenuItem>
        {!m.hasAccount && m.active ? (
          <DropdownMenuItem onSelect={() => run(() => inviteMember(m.id, "member"))} disabled={!m.email}>
            <Mail /> {m.invited ? "Resend invitation" : "Invite to the app"}
          </DropdownMenuItem>
        ) : null}
        {m.hasAccount && !m.isMe && m.active ? (
          m.role === "admin" ? (
            <DropdownMenuItem onSelect={() => run(() => setMemberRole(m.id, "member"))}><ShieldOff /> Remove admin rights</DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => run(() => setMemberRole(m.id, "admin"))}><ShieldCheck /> Make administrator</DropdownMenuItem>
          )
        ) : null}
        {!m.isMe ? (
          <>
            <DropdownMenuSeparator />
            {m.active ? (
              <DropdownMenuItem variant="destructive" onSelect={() => run(() => setMemberActive(m.id, false))}><UserX /> Deactivate</DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => run(() => setMemberActive(m.id, true))}><UserCheck /> Reactivate</DropdownMenuItem>
            )}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MemberForm({ units, initial, onDone }: { units: Unit[]; initial: Partial<MemberView> & { unitId: string }; onDone: () => void }) {
  const [v, setV] = useState({
    unitId: initial.unitId,
    fullName: initial.fullName ?? "",
    phone: initial.phone ?? "",
    email: initial.email ?? "",
    relation: initial.relation ?? "",
    dutyLabel: initial.dutyLabel ?? "",
    joinedOn: initial.joinedOn ?? new Date().toISOString().slice(0, 10),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((x) => ({ ...x, [k]: e.target.value }));

  return (
    <form
      className="space-y-4 pb-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveMember({ id: initial.id, ...v });
          if (r.ok) {
            toast.success(r.message);
            onDone();
          } else {
            setErrors(Object.fromEntries(Object.entries(r.fieldErrors ?? {}).map(([k, m]) => [k, m[0]])));
            toast.error(r.error);
          }
        });
      }}
    >
      <Field label="Full name" htmlFor="fullName" error={errors.fullName}>
        <Input id="fullName" className="h-10" value={v.fullName} onChange={set("fullName")} required autoFocus />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Household" htmlFor="unit">
          <Select value={v.unitId} onValueChange={(unitId) => setV((x) => ({ ...x, unitId }))}>
            <SelectTrigger id="unit" className="h-10 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{units.map((u) => <SelectItem key={u.id} value={u.id}>{u.code}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Relation (optional)" htmlFor="relation">
          <Input id="relation" className="h-10" value={v.relation} onChange={set("relation")} placeholder="e.g. Wife, Son" />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone" htmlFor="phone" error={errors.phone}>
          <Input id="phone" type="tel" className="h-10" value={v.phone} onChange={set("phone")} />
        </Field>
        <Field label="Email" htmlFor="email" error={errors.email} hint="Needed to invite them to the app">
          <Input id="email" type="email" className="h-10" value={v.email} onChange={set("email")} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Joined on" htmlFor="joinedOn" error={errors.joinedOn}>
          <Input id="joinedOn" type="date" className="h-10" value={v.joinedOn} onChange={set("joinedOn")} />
        </Field>
        <Field label="Kitchen duty label" htmlFor="dutyLabel" hint="Shown in the duty roster, e.g. P1">
          <Input id="dutyLabel" className="h-10" value={v.dutyLabel} onChange={set("dutyLabel")} />
        </Field>
      </div>
      <div className="flex gap-2 pt-2">
        <Button type="button" variant="outline" className="h-11 flex-1" onClick={onDone}>Cancel</Button>
        <Button type="submit" className="h-11 flex-[2]" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          {initial.id ? "Save changes" : "Add member"}
        </Button>
      </div>
    </form>
  );
}
