'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Mail, MessageSquare, Megaphone, Share2, Bot, BarChart3,
  Settings, ChevronLeft, ChevronRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const navigation = [
  {
    name: 'Inbox',
    href: '/admin/command-center/inbox',
    icon: Mail,
    description: 'Unified email inbox'
  },
  {
    name: 'Campaigns',
    href: '/admin/command-center/campaigns',
    icon: Megaphone,
    description: 'Email campaigns'
  },
  {
    name: 'Social',
    href: '/admin/command-center/social',
    icon: Share2,
    description: 'Social media manager'
  },
  {
    name: 'HealthBot',
    href: '/admin/command-center/healthbot',
    icon: Bot,
    description: 'AI assistant'
  },
  {
    name: 'Analytics',
    href: '/admin/command-center/analytics',
    icon: BarChart3,
    description: 'Performance metrics'
  }
];

export default function CommandCenterLayout({ children }) {
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="flex h-[calc(100vh-4rem)] bg-background">
      {/* Sidebar */}
      <aside
        className={cn(
          'relative flex flex-col border-r border-border bg-card transition-all duration-300',
          sidebarCollapsed ? 'w-16' : 'w-64'
        )}
      >
        {/* Header */}
        <div className={cn(
          'flex items-center gap-3 p-4 border-b border-border',
          sidebarCollapsed && 'justify-center'
        )}>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center flex-shrink-0">
            <MessageSquare className="w-5 h-5 text-white" />
          </div>
          {!sidebarCollapsed && (
            <div>
              <h2 className="font-semibold text-foreground">Command Center</h2>
              <p className="text-xs text-muted-foreground">Communications Hub</p>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-2 space-y-1">
          {navigation.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all',
                  'hover:bg-accent hover:text-accent-foreground',
                  isActive && 'bg-primary/10 text-primary font-medium',
                  sidebarCollapsed && 'justify-center px-2'
                )}
                title={sidebarCollapsed ? item.name : undefined}
              >
                <item.icon className={cn(
                  'w-5 h-5 flex-shrink-0',
                  isActive ? 'text-primary' : 'text-muted-foreground'
                )} />
                {!sidebarCollapsed && (
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{item.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{item.description}</p>
                  </div>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Settings Link */}
        <div className="p-2 border-t border-border">
          <Link
            href="/admin/command-center/settings"
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all',
              'hover:bg-accent hover:text-accent-foreground text-muted-foreground',
              sidebarCollapsed && 'justify-center px-2'
            )}
          >
            <Settings className="w-5 h-5" />
            {!sidebarCollapsed && <span className="text-sm">Settings</span>}
          </Link>
        </div>

        {/* Collapse Toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="absolute -right-3 top-20 w-6 h-6 rounded-full border shadow-sm bg-background"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        >
          {sidebarCollapsed ? (
            <ChevronRight className="w-3 h-3" />
          ) : (
            <ChevronLeft className="w-3 h-3" />
          )}
        </Button>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}

