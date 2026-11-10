"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const APP_NAV = [
  { href: "/app", label: "Inbox", hint: "Everything that arrived" },
  { href: "/app/review", label: "Needs review", hint: "Exceptions waiting on a person" },
  { href: "/app/posted", label: "Posted", hint: "In your ERP" },
  { href: "/app/rejected", label: "Rejected", hint: "Not orders, or declined" },
  { href: "/app/customers", label: "Customers", hint: "Aliases, rules, ship-tos" },
  { href: "/app/items", label: "Items", hint: "Item master and matches" },
  { href: "/app/settings", label: "Settings", hint: "ERP, intake address, users, billing" },
] as const;

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Application" className="flex flex-col gap-0.5">
      {APP_NAV.map((item) => {
        const active = item.href === "/app" ? pathname === "/app" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            title={item.hint}
            className={`rounded-md px-3 py-2 text-sm transition-colors ${
              active ? "bg-accent-soft font-medium text-accent-strong" : "text-muted hover:bg-bg-subtle hover:text-fg"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
