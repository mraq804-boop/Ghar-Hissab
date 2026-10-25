import {
  CookingPot,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  MessagesSquare,
  PiggyBank,
  AlarmClock,
  Receipt,
  Scale,
  Settings,
  Users,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  keepPeriod?: boolean;
};

export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, keepPeriod: true },
  { href: "/expenses", label: "Expenses", icon: Receipt, keepPeriod: true },
  { href: "/payments", label: "Payments", icon: Wallet, keepPeriod: true },
  { href: "/me", label: "My spending", icon: PiggyBank },
  { href: "/division", label: "Expense division", icon: Scale, keepPeriod: true },
  { href: "/bills", label: "Bills", icon: Zap },
  { href: "/family", label: "Family", icon: Users },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/ask", label: "Ask", icon: MessagesSquare },
  { href: "/reminders", label: "Reminders", icon: AlarmClock },
  { href: "/kitchen", label: "Kitchen", icon: CookingPot },
  { href: "/sync", label: "Excel sync", icon: FileSpreadsheet, adminOnly: true },
  { href: "/settings", label: "Settings", icon: Settings, adminOnly: true },
];

export const MOBILE_TABS = ["/dashboard", "/expenses", "/payments", "/bills"];
