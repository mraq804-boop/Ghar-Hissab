"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlarmClock, Loader2, Pencil, Plus, Repeat, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmButton } from "@/components/ledger/confirm-button";
import { Field } from "@/components/ledger/field";
import { Panel } from "@/components/ledger/page-header";
import { ResponsiveDialog } from "@/components/ledger/responsive-dialog";
import { cn } from "@/lib/utils";
import { deleteReminder, saveReminder, snoozeReminder } from "../notifications/actions";

type Repeat = "none" | "daily" | "weekly" | "monthly";
export type ReminderView = { id: string; title: string; note: string | null; audience: "me" | "family"; repeat: Repeat; active: boolean; date: string; time: string; mine: boolean; canEdit: boolean };

const REPEAT_LABEL: Record<Repeat, string> = { none: "Once", daily: "Every day", weekly: "Every week", monthly: "Every month" };
const when = (r: ReminderView) => `${new Date(`${r.date}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}, ${r.time}`;

export function RemindersBoard({ reminders, today }: { reminders: ReminderView[]; today: string }) {
  const [editing, setEditing] = useState<ReminderView | "new" | null>(null);
  const router = useRouter();
  const [pending, start] = useTransition();
  const upcoming = reminders.filter((r) => r.active);
  const done = reminders.filter((r) => !r.active);

  const act = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Done");
      else toast.error(r.error ?? "Something went wrong");
      router.refresh();
    });

  const row = (r: ReminderView) => (
    <li key={r.id} className={cn("flex items-start gap-3 px-5 py-3", !r.active && "opacity-60")}>
      <AlarmClock className="mt-0.5 size-4 shrink-0 text-haldi" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{r.title}</p>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span>{r.active ? when(r) : "Done"}</span>
          {r.repeat !== "none" ? <span className="inline-flex items-center gap-1"><Repeat className="size-3" />{REPEAT_LABEL[r.repeat]}</span> : null}
          {r.audience === "family" ? <span className="inline-flex items-center gap-1"><Users className="size-3" />Family{r.mine ? "" : " (from someone else)"}</span> : null}
        </p>
        {r.note ? <p className="mt-0.5 text-xs text-muted-foreground">{r.note}</p> : null}
      </div>
      {r.canEdit ? (
        <div className="flex gap-1">
          {r.active ? <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => snoozeReminder(r.id))}>+1 day</Button> : null}
          <Button size="icon" variant="ghost" aria-label="Edit reminder" onClick={() => setEditing(r)}><Pencil /></Button>
          <ConfirmButton size="icon" variant="ghost" aria-label="Delete reminder" title={`Delete "${r.title}"?`} description={r.audience === "family" ? "It's removed for the whole family." : "It's removed for you."} confirmLabel="Delete" destructive onConfirm={() => act(() => deleteReminder(r.id))}>
            <Trash2 />
          </ConfirmButton>
        </div>
      ) : null}
    </li>
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button onClick={() => setEditing("new")}><Plus /> New reminder</Button>
      </div>
      <Panel title="Upcoming" bodyClassName="p-0">
        {upcoming.length ? <ul className="divide-y">{upcoming.map(row)}</ul> : <p className="px-5 py-8 text-center text-sm text-muted-foreground">No reminders yet. Try &quot;Pay maid&quot;, every month on the 1st.</p>}
      </Panel>
      {done.length ? (
        <Panel title="Done" bodyClassName="p-0"><ul className="divide-y">{done.map(row)}</ul></Panel>
      ) : null}
      {editing ? (
        <ReminderDialog
          reminder={editing === "new" ? null : editing}
          today={today}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            start(() => router.refresh());
          }}
        />
      ) : null}
    </div>
  );
}

function ReminderDialog({ reminder, today, onClose, onSaved }: { reminder: ReminderView | null; today: string; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(reminder?.title ?? "");
  const [note, setNote] = useState(reminder?.note ?? "");
  const [date, setDate] = useState(reminder?.date ?? today);
  const [time, setTime] = useState(reminder?.time ?? "09:00");
  const [repeat, setRepeat] = useState<Repeat>(reminder?.repeat ?? "none");
  const [audience, setAudience] = useState<"me" | "family">(reminder?.audience ?? "me");
  const [saving, start] = useTransition();

  const save = () =>
    start(async () => {
      const r = await saveReminder({ id: reminder?.id, title, note, date, time, repeat, audience });
      if (r.ok) {
        toast.success(r.message ?? "Saved");
        onSaved();
      } else toast.error(r.error);
    });

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && !saving && onClose()} title={reminder ? "Edit reminder" : "New reminder"}>
      <div className="space-y-4 pb-4">
        <Field label="What" htmlFor="rem-title"><Input id="rem-title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="Pay maid" className="h-10" /></Field>
        <Field label="Note (optional)" htmlFor="rem-note"><Input id="rem-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} className="h-10" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date" htmlFor="rem-date"><Input id="rem-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-10" /></Field>
          <Field label="Time" htmlFor="rem-time"><Input id="rem-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-10" /></Field>
          <Field label="Repeat" htmlFor="rem-repeat">
            <Select value={repeat} onValueChange={(v) => setRepeat(v as Repeat)}>
              <SelectTrigger id="rem-repeat" className="h-10 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{(Object.keys(REPEAT_LABEL) as Repeat[]).map((k) => <SelectItem key={k} value={k}>{REPEAT_LABEL[k]}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="For" htmlFor="rem-audience">
            <Select value={audience} onValueChange={(v) => setAudience(v as "me" | "family")}>
              <SelectTrigger id="rem-audience" className="h-10 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="me">Only me</SelectItem>
                <SelectItem value="family">Whole family</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">Rings within about 15 minutes of the time. During quiet hours it waits until they end.</p>
        <div className="flex gap-2">
          <Button variant="outline" className="h-11 flex-1" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button className="h-11 flex-[2]" onClick={save} disabled={saving || !title.trim()}>{saving ? <Loader2 className="animate-spin" /> : null} Save</Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
}
