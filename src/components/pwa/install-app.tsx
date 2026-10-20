"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Download, Share, SquarePlus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

const standaloneQuery = "(display-mode: standalone)";

function subscribe(cb: () => void) {
  const mq = window.matchMedia(standaloneQuery);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

function useInstalled() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(standaloneQuery).matches || (navigator as Navigator & { standalone?: boolean }).standalone === true,
    () => true,
  );
}

function useIsIos() {
  return useSyncExternalStore(
    () => () => undefined,
    () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
    () => false,
  );
}

export function InstallAppItem() {
  const installed = useInstalled();
  const ios = useIsIos();
  const [deferred, setDeferred] = useState<InstallEvent | null>(null);
  const [showIos, setShowIos] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as InstallEvent);
    };
    const onInstalled = () => setDeferred(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || (!deferred && !ios)) return null;

  return (
    <>
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip="Install app"
          className="h-9 border border-sidebar-primary/40 text-sidebar-primary hover:text-sidebar-primary"
          onClick={async () => {
            if (deferred) {
              await deferred.prompt();
              await deferred.userChoice;
              setDeferred(null);
            } else setShowIos(true);
          }}
        >
          <Download />
          <span>Install app</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
      <Dialog open={showIos} onOpenChange={setShowIos}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Ghar Hisaab to your Home Screen</DialogTitle>
            <DialogDescription>It opens full screen like a normal app.</DialogDescription>
          </DialogHeader>
          <ol className="space-y-3 text-sm">
            <li className="flex items-center gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted"><Share className="size-4" /></span>
              In Safari, tap the <strong>Share</strong> button at the bottom of the screen.
            </li>
            <li className="flex items-center gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted"><SquarePlus className="size-4" /></span>
              Scroll down and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
            </li>
          </ol>
        </DialogContent>
      </Dialog>
    </>
  );
}
