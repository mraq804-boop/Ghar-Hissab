"use client";

import { useEffect } from "react";
import { toast } from "sonner";

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    let acceptedUpdate = false;

    const offerUpdate = (worker: ServiceWorker) =>
      toast("A new version of Ghar Hisaab is ready", {
        duration: Infinity,
        action: {
          label: "Reload",
          onClick: () => {
            acceptedUpdate = true;
            worker.postMessage("SKIP_WAITING");
          },
        },
      });

    const onControllerChange = () => {
      if (acceptedUpdate) window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    let onVisible: (() => void) | undefined;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((reg) => {
        if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const next = reg.installing;
          next?.addEventListener("statechange", () => {
            if (next.state === "installed" && navigator.serviceWorker.controller) offerUpdate(next);
          });
        });
        onVisible = () => {
          if (document.visibilityState === "visible") reg.update().catch(() => undefined);
        };
        document.addEventListener("visibilitychange", onVisible);
      })
      .catch((e) => console.warn("Service worker registration failed", e));

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      if (onVisible) document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
