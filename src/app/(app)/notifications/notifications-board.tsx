"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bell, BellOff, BellRing, CheckCheck, Loader2, Moon, Smartphone, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field } from "@/components/ledger/field";
import { Panel } from "@/components/ledger/page-header";
import { cn } from "@/lib/utils";
import { markAllRead, removeSubscription, savePrefs, saveSubscription, sendTestNotification } from "./actions";

export type Prefs = { quietStart: string; quietEnd: string; payments: boolean; bills: boolean; meters: boolean; money: boolean; summary: boolean; reminders: boolean; personal: boolean };
type Device = { id: string; endpoint: string; userAgent: string | null; createdAt: string; lastOkAt: string | null };
type Item = { id: string; category: string; title: string; body: string | null; url: string | null; createdAt: string; read: boolean; held: boolean };

const CATEGORIES: { key: keyof Omit<Prefs, "quietStart" | "quietEnd">; label: string; hint: string }[] = [
  { key: "payments", label: "Payments", hint: "Payments to verify, approved or rejected" },
  { key: "bills", label: "Bills", hint: "New bills and due dates" },
  { key: "meters", label: "Meter watch", hint: "Heading over the unit limit, time to read the meter" },
  { key: "money", label: "Money owed & month start", hint: "What your household still owes, starting a new month" },
  { key: "summary", label: "Weekly summary", hint: "Sunday evening" },
  { key: "reminders", label: "Reminders", hint: "Your own and family reminders" },
  { key: "personal", label: "My spending budgets", hint: "Private budget warnings" },
];

function base64ToBytes(s: string) {
  const b64 = (s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function deviceName(ua: string | null) {
  if (!ua) return "Unknown device";
  const os = /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "Mac" : "Device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "browser";
  return `${os} · ${browser}`;
}

const subscribeNothing = () => () => {};
const pushSupport = () => (typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window ? "yes" : "no");
const isIos = () => typeof navigator !== "undefined" && /iPhone|iPad/.test(navigator.userAgent);
const standalone = () => typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);

export function NotificationsBoard({ vapidKey, prefs, devices, items }: { vapidKey: string | null; prefs: Prefs; devices: Device[]; items: Item[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const support = useSyncExternalStore(subscribeNothing, pushSupport, () => "unknown");
  const ios = useSyncExternalStore(subscribeNothing, isIos, () => false);
  const installed = useSyncExternalStore(subscribeNothing, standalone, () => false);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | "unknown">("unknown");
  const [form, setForm] = useState<Prefs>(prefs);

  useEffect(() => {
    if (support !== "yes") return;
    let alive = true;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        if (!alive) return;
        setEndpoint(sub?.endpoint ?? null);
        setPermission(Notification.permission);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [support]);

  const thisDevice = endpoint ? devices.find((d) => d.endpoint === endpoint) : undefined;

  const enable = () =>
    start(async () => {
      if (!vapidKey) return void toast.error("Push isn't set up on the server yet.");
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") return void toast.error("Notifications are blocked. Allow them for this app in the phone's settings.");
      try {
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(vapidKey) }));
        const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
        const r = await saveSubscription({ endpoint: json.endpoint, keys: json.keys, userAgent: navigator.userAgent.slice(0, 300) });
        if (!r.ok) return void toast.error(r.error);
        setEndpoint(json.endpoint);
        toast.success(r.message ?? "Notifications on");
        router.refresh();
      } catch {
        toast.error("This phone couldn't turn on notifications. Try again, or check the browser's notification setting.");
      }
    });

  const disable = () =>
    start(async () => {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await removeSubscription(sub.endpoint);
        await sub.unsubscribe().catch(() => undefined);
      }
      setEndpoint(null);
      toast.success("Notifications off for this phone");
      router.refresh();
    });

  const act = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Done");
      else toast.error(r.error ?? "Something went wrong");
      router.refresh();
    });

  const unread = items.filter((i) => !i.read).length;

  return (
    <div className="space-y-6">
      <Panel title="This phone" description="Notifications ring even when the app is closed.">
        {support === "no" ? (
          <p className="text-sm text-muted-foreground">This browser can&apos;t receive notifications. Use Chrome or Edge on Android, or Safari on iPhone after adding the app to the Home Screen.</p>
        ) : ios && !installed ? (
          <p className="text-sm text-muted-foreground">
            On iPhone, notifications work only from the installed app: tap <strong>Share</strong> → <strong>Add to Home Screen</strong>, open Ghar Hisaab from the Home Screen, then come back here. Needs iOS 16.4 or newer.
          </p>
        ) : !vapidKey ? (
          <p className="text-sm text-muted-foreground">Push isn&apos;t set up on the server yet. The administrator needs to add the VAPID keys.</p>
        ) : thisDevice || (endpoint && permission === "granted") ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex items-center gap-2 text-sm text-success"><BellRing className="size-4" /> Notifications are on for this phone.</p>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => act(sendTestNotification)}><Bell /> Send test</Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={disable}><BellOff /> Turn off</Button>
          </div>
        ) : permission === "denied" ? (
          <p className="text-sm text-destructive">Notifications are blocked for this app. Allow them in the browser or phone settings, then reload.</p>
        ) : (
          <Button disabled={pending || support !== "yes"} onClick={enable}>{pending ? <Loader2 className="animate-spin" /> : <BellRing />} Turn on notifications</Button>
        )}
      </Panel>

      <Panel title="What to notify me about">
        <div className="space-y-3">
          {CATEGORIES.map((c) => (
            <label key={c.key} className="flex items-center justify-between gap-4">
              <span>
                <span className="block text-sm font-medium">{c.label}</span>
                <span className="block text-xs text-muted-foreground">{c.hint}</span>
              </span>
              <Switch checked={form[c.key]} onCheckedChange={(v) => setForm((f) => ({ ...f, [c.key]: v }))} />
            </label>
          ))}
          <div className="grid gap-3 border-t pt-4 sm:grid-cols-2">
            <p className="flex items-center gap-2 text-sm font-medium sm:col-span-2"><Moon className="size-4" /> Quiet hours (alerts wait until they end)</p>
            <Field label="From" htmlFor="quiet-start"><Input id="quiet-start" type="time" value={form.quietStart} onChange={(e) => setForm((f) => ({ ...f, quietStart: e.target.value }))} className="h-10" /></Field>
            <Field label="Until" htmlFor="quiet-end"><Input id="quiet-end" type="time" value={form.quietEnd} onChange={(e) => setForm((f) => ({ ...f, quietEnd: e.target.value }))} className="h-10" /></Field>
          </div>
          <Button disabled={pending} onClick={() => act(() => savePrefs(form))}>Save</Button>
        </div>
      </Panel>

      {devices.length ? (
        <Panel title="My devices" bodyClassName="p-0">
          <ul className="divide-y">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                <Smartphone className="size-4 text-muted-foreground" />
                <span className="flex-1">
                  {deviceName(d.userAgent)}
                  {d.endpoint === endpoint ? <span className="text-muted-foreground"> · this phone</span> : null}
                </span>
                <Button size="icon" variant="ghost" aria-label="Turn off notifications for this device" disabled={pending} onClick={() => act(() => removeSubscription(d.id))}><Trash2 /></Button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel
        title="Recent"
        description={unread ? `${unread} unread` : "All read"}
        actions={unread ? <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(markAllRead)}><CheckCheck /> Mark all read</Button> : null}
        bodyClassName="p-0"
      >
        {items.length ? (
          <ul className="divide-y">
            {items.map((n) => (
              <li key={n.id}>
                <Link href={n.url ?? "/dashboard"} className={cn("flex gap-3 px-5 py-3 hover:bg-muted/50", !n.read && "bg-accent/30")}>
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-haldi")} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{n.title}</span>
                    {n.body ? <span className="block text-xs text-muted-foreground">{n.body}</span> : null}
                    <span className="block text-[11px] text-muted-foreground">
                      {new Date(n.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                      {n.held ? " · waiting to be sent (quiet hours)" : ""}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">Nothing yet. Alerts and reminders will appear here.</p>
        )}
      </Panel>
    </div>
  );
}
