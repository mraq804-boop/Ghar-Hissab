"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KeyRound, Loader2, Lock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Field } from "@/components/ledger/field";
import { Panel } from "@/components/ledger/page-header";
import { ResponsiveDialog } from "@/components/ledger/responsive-dialog";
import { createRule, saveCategory, saveSettings, setRuleActive } from "./actions";

type Settings = { membersSeeAllExpenses: boolean; membersSeeAllBalances: boolean; membersSeeReports: boolean; maxUploadMb: number };
type Category = { id: string; name: string; section_id: string; default_split_rule_id: string | null; active: boolean };
type Rule = { id: string; name: string; description: string | null; system: boolean; active: boolean; summary: string };
const NONE = "__none";

export function SettingsBoard({ settings, units, sections, categories, rules }: { settings: Settings; units: { id: string; code: string }[]; sections: { id: string; title: string }[]; categories: Category[]; rules: Rule[] }) {
  return (
    <Tabs defaultValue="access">
      <TabsList className="mb-5 flex-wrap">
        <TabsTrigger value="access">Access</TabsTrigger>
        <TabsTrigger value="categories">Categories</TabsTrigger>
        <TabsTrigger value="rules">Sharing rules</TabsTrigger>
        <TabsTrigger value="account">Your account</TabsTrigger>
      </TabsList>
      <TabsContent value="access"><AccessSettings initial={settings} /></TabsContent>
      <TabsContent value="categories"><Categories sections={sections} categories={categories} rules={rules} /></TabsContent>
      <TabsContent value="rules"><Rules units={units} rules={rules} /></TabsContent>
      <TabsContent value="account">
        <Panel title="Password">
          <p className="text-sm text-muted-foreground">Change the password you use with your email address.</p>
          <Button asChild variant="outline" className="mt-4"><Link href="/settings/password"><KeyRound /> Change password</Link></Button>
        </Panel>
      </TabsContent>
    </Tabs>
  );
}

function AccessSettings({ initial }: { initial: Settings }) {
  const [v, setV] = useState(initial);
  const [pending, start] = useTransition();
  const router = useRouter();
  const rows: [keyof Settings, string, string][] = [
    ["membersSeeAllExpenses", "Members can see every household expense", "Off: members only see their own shares and balance."],
    ["membersSeeAllBalances", "Members can see other households' balances and payments", "Screenshots always stay private to the payer and administrators."],
    ["membersSeeReports", "Members can open reports", "Reports still respect the two settings above."],
  ];
  return (
    <Panel title="What family members can see" bodyClassName="p-0">
      <ul className="divide-y">
        {rows.map(([k, label, hint]) => (
          <li key={k} className="flex items-start justify-between gap-4 px-5 py-4">
            <label htmlFor={k} className="min-w-0">
              <span className="block text-sm font-medium">{label}</span>
              <span className="block text-xs text-muted-foreground">{hint}</span>
            </label>
            <Switch id={k} checked={Boolean(v[k])} onCheckedChange={(c) => setV((x) => ({ ...x, [k]: c }))} />
          </li>
        ))}
        <li className="flex items-center justify-between gap-4 px-5 py-4">
          <label htmlFor="maxUpload" className="text-sm font-medium">Largest screenshot upload</label>
          <Select value={String(v.maxUploadMb)} onValueChange={(x) => setV((s) => ({ ...s, maxUploadMb: Number(x) }))}>
            <SelectTrigger id="maxUpload" className="h-9 w-28"><SelectValue /></SelectTrigger>
            <SelectContent>{[2, 5, 8, 10].map((n) => <SelectItem key={n} value={String(n)}>{n} MB</SelectItem>)}</SelectContent>
          </Select>
        </li>
      </ul>
      <div className="flex justify-end border-t px-5 py-3">
        <Button
          disabled={pending}
          onClick={() => start(async () => {
            const r = await saveSettings(v);
            if (r.ok) toast.success(r.message);
            else toast.error(r.error);
            router.refresh();
          })}
        >
          {pending ? <Loader2 className="animate-spin" /> : null} Save settings
        </Button>
      </div>
    </Panel>
  );
}

function Categories({ sections, categories, rules }: { sections: { id: string; title: string }[]; categories: Category[]; rules: Rule[] }) {
  const [editing, setEditing] = useState<Partial<Category> | null>(null);
  const router = useRouter();
  return (
    <Panel title="Expense categories" description="Each category belongs to a section of the workbook and suggests a sharing rule." actions={<Button size="sm" onClick={() => setEditing({ active: true, section_id: sections[0]?.id })}><Plus /> Add</Button>} bodyClassName="p-0">
      <ul className="divide-y">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-5 py-3">
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-medium ${c.active ? "" : "text-muted-foreground line-through"}`}>{c.name}</p>
              <p className="text-xs text-muted-foreground">{sections.find((s) => s.id === c.section_id)?.title}, {rules.find((r) => r.id === c.default_split_rule_id)?.name ?? "no default rule"}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setEditing(c)}>Edit</Button>
          </li>
        ))}
      </ul>
      <ResponsiveDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={editing?.id ? "Edit category" : "Add category"}>
        {editing ? <CategoryForm initial={editing} sections={sections} rules={rules} onDone={() => { setEditing(null); router.refresh(); }} /> : null}
      </ResponsiveDialog>
    </Panel>
  );
}

function CategoryForm({ initial, sections, rules, onDone }: { initial: Partial<Category>; sections: { id: string; title: string }[]; rules: Rule[]; onDone: () => void }) {
  const [name, setName] = useState(initial.name ?? "");
  const [sectionId, setSectionId] = useState(initial.section_id ?? sections[0]?.id ?? "");
  const [ruleId, setRuleId] = useState(initial.default_split_rule_id ?? NONE);
  const [active, setActive] = useState(initial.active ?? true);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-4 pb-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveCategory({ id: initial.id, name, sectionId, ruleId: ruleId === NONE ? null : ruleId, active });
          if (r.ok) {
            toast.success(r.message);
            onDone();
          } else toast.error(r.error);
        });
      }}
    >
      <Field label="Name" htmlFor="cat-name"><Input id="cat-name" className="h-10" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      <Field label="Workbook section" htmlFor="cat-section">
        <Select value={sectionId} onValueChange={setSectionId}>
          <SelectTrigger id="cat-section" className="h-10 w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{sections.map((s) => <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label="Default sharing rule" htmlFor="cat-rule">
        <Select value={ruleId} onValueChange={setRuleId}>
          <SelectTrigger id="cat-rule" className="h-10 w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>None</SelectItem>
            {rules.filter((r) => r.active).map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      <label className="flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm">
        Offer this category for new expenses
        <Switch checked={active} onCheckedChange={setActive} />
      </label>
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="h-11 flex-1" onClick={onDone}>Cancel</Button>
        <Button type="submit" className="h-11 flex-[2]" disabled={pending || !name.trim()}>{pending ? <Loader2 className="animate-spin" /> : null} Save</Button>
      </div>
    </form>
  );
}

function Rules({ units, rules }: { units: { id: string; code: string }[]; rules: Rule[] }) {
  const [creating, setCreating] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Panel title="Sharing rules" description="The workbook's rules are locked so past months never change. Add new rules for new arrangements." actions={<Button size="sm" onClick={() => setCreating(true)}><Plus /> New rule</Button>} bodyClassName="p-0">
      <ul className="divide-y">
        {rules.map((r) => (
          <li key={r.id} className="flex items-center gap-3 px-5 py-3">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm font-medium">{r.name}{r.system ? <Lock className="size-3 text-muted-foreground" aria-label="From the workbook" /> : null}</p>
              <p className="text-xs text-muted-foreground">{r.summary}{r.description ? `. ${r.description}` : ""}</p>
            </div>
            {!r.system ? (
              <Switch
                checked={r.active}
                disabled={pending}
                aria-label={`Offer ${r.name} for new expenses`}
                onCheckedChange={(c) => start(async () => {
                  const res = await setRuleActive(r.id, c);
                  if (!res.ok) toast.error(res.error);
                  router.refresh();
                })}
              />
            ) : null}
          </li>
        ))}
      </ul>
      <ResponsiveDialog open={creating} onOpenChange={setCreating} title="New sharing rule">
        {creating ? <RuleForm units={units} onDone={() => { setCreating(false); router.refresh(); }} /> : null}
      </ResponsiveDialog>
    </Panel>
  );
}

function RuleForm({ units, onDone }: { units: { id: string; code: string }[]; onDone: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<"equal_units" | "weights" | "percentage">("equal_units");
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(units.map((u) => [u.id, ""])));
  const [selected, setSelected] = useState<string[]>(units.map((u) => u.id));
  const [pending, start] = useTransition();

  const parts = () => {
    if (type === "equal_units") return selected.map((unitId) => ({ unitId }));
    if (type === "percentage") return units.filter((u) => Number(values[u.id]) > 0).map((u) => ({ unitId: u.id, percent: Number(values[u.id]) }));
    return units
      .filter((u) => /^\d+\/\d+$/.test(values[u.id]?.trim() ?? ""))
      .map((u) => {
        const [num, den] = values[u.id].split("/").map(Number);
        return { unitId: u.id, num, den };
      });
  };

  return (
    <form
      className="space-y-4 pb-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await createRule({ name, description, type, parts: parts() });
          if (r.ok) {
            toast.success(r.message);
            onDone();
          } else toast.error(r.error);
        });
      }}
    >
      <Field label="Name" htmlFor="rule-name"><Input id="rule-name" className="h-10" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. AQ + AK only" autoFocus /></Field>
      <Field label="Description (optional)" htmlFor="rule-desc"><Input id="rule-desc" className="h-10" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <Field label="How it divides" htmlFor="rule-type">
        <Select value={type} onValueChange={(t) => setType(t as typeof type)}>
          <SelectTrigger id="rule-type" className="h-10 w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="equal_units">Equally between chosen households</SelectItem>
            <SelectItem value="weights">Fractions, e.g. 4/9</SelectItem>
            <SelectItem value="percentage">Percentages</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {type === "equal_units" ? (
        <div className="flex flex-wrap gap-2">
          {units.map((u) => (
            <label key={u.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
              <Switch checked={selected.includes(u.id)} onCheckedChange={(c) => setSelected((s) => (c ? [...s, u.id] : s.filter((x) => x !== u.id)))} /> {u.code}
            </label>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {units.map((u) => (
            <Field key={u.id} label={u.code} htmlFor={`rp-${u.id}`}>
              <Input id={`rp-${u.id}`} className="num h-10" value={values[u.id]} placeholder={type === "percentage" ? "%" : "1/3"} onChange={(e) => setValues((v) => ({ ...v, [u.id]: e.target.value }))} />
            </Field>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="h-11 flex-1" onClick={onDone}>Cancel</Button>
        <Button type="submit" className="h-11 flex-[2]" disabled={pending || name.trim().length < 2}>{pending ? <Loader2 className="animate-spin" /> : null} Create rule</Button>
      </div>
    </form>
  );
}
