"use client";

import * as React from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface ComboboxOption {
  value: string;
  label: string;
  sublabel?: string;
  disabled?: boolean;
}

interface ComboboxProps {
  options: ComboboxOption[];
  value?: string;
  onSelect: (value: string) => void;
  onClear?: () => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function Combobox({
  options,
  value,
  onSelect,
  onClear,
  placeholder = "Assign…",
  disabled = false,
  className,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setSearch("");
    }
  }, [open]);

  const selected = options.find((o) => o.value === value);

  const filtered = React.useMemo(() => {
    if (!search) return options;
    const q = search.toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.sublabel?.toLowerCase().includes(q) ?? false)
    );
  }, [options, search]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "h-9 justify-between text-xs font-normal w-36 px-3",
            !selected && "text-muted-foreground",
            className
          )}
        >
          <span className="truncate">{selected ? selected.label : placeholder}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 ml-1 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <div className="p-2 border-b">
          <Input
            ref={inputRef}
            placeholder="Search tag #…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 text-xs"
          />
        </div>
        <div className="max-h-48 overflow-y-auto">
          {filtered.length === 0 && (
            <p className="px-3 py-4 text-xs text-muted-foreground text-center">
              No items found.
            </p>
          )}
          {filtered.map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={opt.disabled}
              onClick={() => {
                if (!opt.disabled) {
                  onSelect(opt.value);
                  setOpen(false);
                }
              }}
              className={cn(
                "flex w-full items-center px-3 py-2 text-xs gap-2 hover:bg-muted transition-colors",
                opt.value === value && "bg-primary/10 font-medium",
                opt.disabled && "opacity-40 cursor-not-allowed"
              )}
            >
              <Check
                className={cn(
                  "h-3.5 w-3.5 shrink-0",
                  opt.value === value ? "opacity-100" : "opacity-0"
                )}
              />
              <span className="truncate flex-1 text-left">{opt.label}</span>
              {opt.sublabel && (
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {opt.sublabel}
                </span>
              )}
            </button>
          ))}
        </div>
        {value && onClear && (
          <div className="border-t p-1.5">
            <button
              type="button"
              onClick={() => {
                onClear();
                setOpen(false);
              }}
              className="flex w-full items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground rounded hover:text-destructive hover:bg-destructive/5 transition-colors"
            >
              <X className="h-3 w-3" />
              Clear assignment
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
