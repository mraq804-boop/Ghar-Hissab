"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Wallet } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { NAV } from "./nav";

export function CommandMenu({ role }: { role: "admin" | "member" | null }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className="hidden h-9 w-56 justify-start gap-2 rounded-full bg-card px-3 font-normal text-muted-foreground lg:flex"
      >
        <Search className="size-4" />
        Search or jump to…
        <kbd className="ml-auto rounded border bg-muted px-1.5 text-[10px] font-medium">Ctrl K</kbd>
      </Button>
      <Button variant="ghost" size="icon" className="size-9 lg:hidden" onClick={() => setOpen(true)} aria-label="Search">
        <Search className="size-4" />
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Jump to a page or start an action">
        <CommandInput placeholder="Type a page or action…" />
        <CommandList>
          <CommandEmpty>Nothing matches that.</CommandEmpty>
          <CommandGroup heading="Actions">
            {role === "admin" ? (
              <CommandItem onSelect={() => go("/expenses?new=1")}>
                <Plus /> Add expense
              </CommandItem>
            ) : null}
            <CommandItem onSelect={() => go("/payments?new=1")}>
              <Wallet /> Record a payment
            </CommandItem>
            {role === "admin" ? (
              <CommandItem onSelect={() => go("/payments?status=pending")}>
                <Wallet /> Review pending payments
              </CommandItem>
            ) : null}
          </CommandGroup>
          <CommandGroup heading="Pages">
            {NAV.filter((n) => !n.adminOnly || role === "admin").map((n) => (
              <CommandItem key={n.href} onSelect={() => go(n.href)}>
                <n.icon /> {n.label}
                {n.href === "/dashboard" ? <CommandShortcut>Home</CommandShortcut> : null}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
