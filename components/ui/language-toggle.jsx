'use client';

import { useMemo } from 'react';
import { Languages } from 'lucide-react';
import { useI18n } from '@/components/providers/I18nProvider';
import { SUPPORTED_LANGS } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export function LanguageToggle({ className }) {
  const { lang, setLang } = useI18n();

  const options = useMemo(() => SUPPORTED_LANGS, []);

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Languages className="w-4 h-4 text-muted-foreground" />
      <select
        value={lang}
        onChange={(e) => setLang(e.target.value)}
        className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none"
        aria-label="Language"
      >
        {options.map((o) => (
          <option key={o.code} value={o.code}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

