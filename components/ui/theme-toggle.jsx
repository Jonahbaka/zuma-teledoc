'use client';

import { useEffect, useMemo, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { applyTheme, getStoredTheme, getSystemTheme, setStoredTheme } from '@/lib/theme';

export function ThemeToggle({ variant = 'ghost', size = 'icon', className = '' }) {
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState('light');

  useEffect(() => {
    setMounted(true);
    const stored = getStoredTheme();
    const initial = stored || getSystemTheme();
    setTheme(initial);
    applyTheme(initial);
  }, []);

  const Icon = useMemo(() => (theme === 'dark' ? Sun : Moon), [theme]);
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';

  if (!mounted) {
    // Avoid hydration mismatch for icon
    return (
      <Button variant={variant} size={size} className={className} aria-label="Toggle theme" disabled />
    );
  }

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setStoredTheme(next);
    applyTheme(next);
  };

  return (
    <Button variant={variant} size={size} className={className} onClick={toggle} aria-label={label} title={label}>
      <Icon className="w-5 h-5" />
    </Button>
  );
}


