"use client";

import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Check, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ComboboxOption } from '@/components/ui/combobox';

/** Inline searchable player picker for use INSIDE dialogs. Renders everything
 *  in place (no popover/portal), so it isn't blocked by a modal dialog's
 *  focus/pointer trapping the way the Popover-based Combobox is. */
export function PlayerPickList({
  options,
  value,
  onSelect,
  placeholder = 'Search players…',
}: {
  options: ComboboxOption[];
  value: string;
  onSelect: (value: string) => void;
  placeholder?: string;
}) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.sublabel?.toLowerCase().includes(q) ?? false)
    );
  }, [options, search]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={placeholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 h-11 rounded-xl"
        />
      </div>
      <div className="max-h-56 overflow-y-auto rounded-xl border divide-y">
        {filtered.length === 0 && (
          <p className="px-3 py-4 text-sm text-muted-foreground text-center">No players match.</p>
        )}
        {filtered.map((opt) => (
          <button
            key={opt.value}
            type="button"
            disabled={opt.disabled}
            onClick={() => !opt.disabled && onSelect(opt.value)}
            className={cn(
              'flex w-full items-center gap-2 px-3 min-h-[44px] text-sm text-left transition-colors hover:bg-secondary/40',
              opt.value === value && 'bg-primary/10 font-medium',
              opt.disabled && 'opacity-40 cursor-not-allowed'
            )}
          >
            <Check className={cn('h-4 w-4 shrink-0', opt.value === value ? 'opacity-100' : 'opacity-0')} />
            <span className="truncate flex-1">{opt.label}</span>
            {opt.sublabel && (
              <span className="text-xs text-muted-foreground shrink-0">{opt.sublabel}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
