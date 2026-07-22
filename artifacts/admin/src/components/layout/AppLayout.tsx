import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Building2, CalendarRange, Home, LogIn, LogOut, Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/i18n";

interface AppLayoutProps {
  children: ReactNode;
  title: string;
  action?: ReactNode;
}

const NAV_ITEMS = [
  { href: "/listings", labelKey: "listings" as const, icon: Home },
  { href: "/calendar", labelKey: "availabilityCalendar" as const, icon: CalendarRange },
];

export function AppLayout({ children, title, action }: AppLayoutProps) {
  const [location] = useLocation();
  const { canManage, signOut } = useAuth();
  const { t } = useI18n();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-border bg-card transition-transform duration-200 ease-in-out md:relative md:translate-x-0 ${
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Logo */}
        <div className="shrink-0 border-b border-border">
          <div className="flex h-16 items-center gap-3 px-5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary">
              <Building2 className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <div className="text-[15px] font-semibold text-foreground leading-tight">
                Kaitran Villas
              </div>
              <div className="text-[11px] text-muted-foreground leading-none mt-0.5">
                {t.nav.operationsCockpit}
              </div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2">
          <ul className="space-y-0.5">
            {NAV_ITEMS.map((item) => {
              const isActive = location === item.href || location.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link href={item.href} onClick={() => setMobileMenuOpen(false)}>
                    <div
                      className={`relative flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-[14px] transition-all duration-100 ${
                        isActive
                          ? "bg-accent text-foreground font-semibold"
                          : "text-muted-foreground font-normal hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      {isActive && (
                        <span className="absolute inset-y-1 left-0 w-[3px] rounded-r-full bg-primary" />
                      )}
                      <item.icon
                        className={`h-4 w-4 shrink-0 ${isActive ? "text-foreground" : "text-muted-foreground"}`}
                      />
                      <span className="truncate">{t.nav[item.labelKey]}</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Auth control */}
        <div className="border-t border-border p-3">
          {canManage ? (
            <Button variant="outline" className="w-full justify-start gap-2" onClick={() => signOut()}>
              <LogOut className="h-4 w-4" />
              {t.nav.signOut}
            </Button>
          ) : (
            <Link href="/login">
              <Button className="w-full justify-start gap-2">
                <LogIn className="h-4 w-4" />
                {t.nav.signIn}
              </Button>
            </Link>
          )}
        </div>
      </aside>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-card px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <h1 className="text-[16px] font-semibold text-foreground">{title}</h1>
          </div>
          <div className="flex items-center gap-3">
            {action}
            {canManage ? (
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => signOut()}>
                <LogOut className="h-4 w-4" />
                {t.nav.signOut}
              </Button>
            ) : (
              <Link href="/login">
                <Button variant="outline" size="sm" className="gap-1.5">
                  <LogIn className="h-4 w-4" />
                  {t.nav.signIn}
                </Button>
              </Link>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto bg-mesh-genz p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>

      {/* Mobile overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}
    </div>
  );
}
