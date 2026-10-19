"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { NAV } from "./nav";
import { usePeriodHref } from "./use-period-href";
import { signOut } from "@/app/(auth)/actions";

export type ShellUser = {
  name: string;
  unitCode: string | null;
  role: "admin" | "member";
  householdName: string;
  pendingReviews: number;
};

export function AppSidebar({ user }: { user: ShellUser }) {
  const hrefFor = usePeriodHref();
  return <SidebarBody user={user} hrefFor={hrefFor} />;
}

export function AppSidebarFallback() {
  return <SidebarBody user={null} hrefFor={(h) => h} />;
}

function SidebarBody({ user, hrefFor }: { user: ShellUser | null; hrefFor: (href: string, keep?: boolean) => string }) {
  const pathname = usePathname();
  const items = NAV.filter((n) => !n.adminOnly || user?.role === "admin");

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader className="px-3 pt-4 pb-2">
        <Link href="/dashboard" className="flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
          <span
            aria-hidden
            className="grid size-8 shrink-0 place-items-center rounded-lg bg-sidebar-primary font-heading text-[15px] font-extrabold text-sidebar-primary-foreground"
          >
            ح
          </span>
          <span className="truncate font-heading text-[17px] font-bold tracking-tight text-white group-data-[collapsible=icon]:hidden">
            Ghar Hisaab
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={item.label}
                      className="h-9 data-[active=true]:bg-sidebar-accent data-[active=true]:text-white data-[active=true]:shadow-[inset_3px_0_0_var(--sidebar-primary)]"
                    >
                      <Link href={hrefFor(item.href, item.keepPeriod)}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                    {item.href === "/payments" && user && user.role === "admin" && user.pendingReviews > 0 ? (
                      <SidebarMenuBadge className="num rounded-full bg-sidebar-primary px-1.5 text-sidebar-primary-foreground">
                        {user.pendingReviews}
                      </SidebarMenuBadge>
                    ) : null}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-3">
        {user ? (
          <div className="flex items-center gap-2.5 rounded-lg p-1.5 group-data-[collapsible=icon]:p-0">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-sidebar-accent font-heading text-xs font-bold text-white">
              {user.unitCode ?? user.name.slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
              <p className="truncate text-sm font-medium text-white">{user.name}</p>
              <p className="truncate text-xs text-sidebar-foreground/70">
                {user.role === "admin" ? "Administrator" : "Family member"}
              </p>
            </div>
            <form action={signOut} className="group-data-[collapsible=icon]:hidden">
              <button
                type="submit"
                className="grid size-8 place-items-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-white focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
                aria-label="Sign out"
              >
                <LogOut className="size-4" />
              </button>
            </form>
          </div>
        ) : (
          <div className="h-11 animate-pulse rounded-lg bg-sidebar-accent/60" />
        )}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
