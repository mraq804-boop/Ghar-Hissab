import { Suspense } from "react";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebarFallback } from "@/components/shell/app-sidebar";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { ShellCommandMenu, ShellSidebar, ShellTopbarData, ShellBottomNav } from "./shell-data";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <SidebarProvider>
      <Suspense fallback={<AppSidebarFallback />}>
        <ShellSidebar />
      </Suspense>
      <SidebarInset className="min-w-0 bg-background">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur-md md:h-16 md:px-6">
          <SidebarTrigger className="-ml-1 hidden size-9 md:inline-flex" />
          <span className="font-heading text-lg font-bold tracking-tight md:hidden">Ghar Hisaab</span>
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <Suspense fallback={<div className="h-9 w-36 animate-pulse rounded-full bg-muted" />}>
              <ShellTopbarData />
            </Suspense>
            <Suspense fallback={null}>
              <ShellCommandMenu />
            </Suspense>
            <ThemeToggle />
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 pt-5 pb-28 md:px-6 md:pt-8 md:pb-12">
          {children}
        </main>
      </SidebarInset>
      <Suspense fallback={null}>
        <ShellBottomNav />
      </Suspense>
    </SidebarProvider>
  );
}
