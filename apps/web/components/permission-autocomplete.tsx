"use client";

import { useMemo, useState } from "react";
import { Check, X } from "lucide-react";

export function PermissionAutocomplete({
  value,
  suggestions,
  onChange,
  placeholder = "Search or add a permission",
  allowWildcard = false,
}: {
  value: string[];
  suggestions: string[];
  onChange: (permissions: string[]) => void;
  placeholder?: string;
  allowWildcard?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const normalized = query.trim();
  const options = useMemo(() => {
    const available = allowWildcard ? ["*", ...suggestions] : suggestions;
    return [...new Set(available)]
      .filter((permission) => !value.includes(permission))
      .filter((permission) =>
        permission.toLowerCase().includes(normalized.toLowerCase()),
      )
      .sort((left, right) => left.localeCompare(right))
      .slice(0, 8);
  }, [allowWildcard, normalized, suggestions, value]);

  function add(permission: string) {
    const next = permission.trim().replace(/,$/, "");
    if (!next || value.includes(next)) return;
    onChange([...value, next]);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className="relative">
      <div className="field flex min-h-10 flex-wrap items-center gap-1.5 py-1.5 focus-within:ring-2 focus-within:ring-ring">
        {value.map((permission) => (
          <span key={permission} className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-2 py-1 font-mono text-[10px]">
            <span className="truncate">{permission}</span>
            <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => onChange(value.filter((item) => item !== permission))} aria-label={`Remove ${permission}`}>
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          className="min-w-32 flex-1 bg-transparent px-1 text-xs outline-none"
          value={query}
          placeholder={value.length ? "Add permission" : placeholder}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 100)}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onKeyDown={(event) => {
            if ((event.key === "Enter" || event.key === "," || event.key === "Tab") && normalized) {
              event.preventDefault();
              add(options[0] ?? normalized);
            } else if (event.key === "Backspace" && !query && value.length) {
              onChange(value.slice(0, -1));
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
        />
      </div>
      {open && (options.length || normalized) ? (
        <div role="listbox" className="absolute z-30 mt-1 max-h-52 w-full overflow-auto rounded-lg border bg-popover p-1 shadow-lg">
          {options.map((permission) => (
            <button key={permission} type="button" role="option" aria-selected="false" className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left font-mono text-[11px] hover:bg-muted" onMouseDown={(event) => event.preventDefault()} onClick={() => add(permission)}>
              <Check size={12} className="text-muted-foreground" /> {permission}
            </button>
          ))}
          {normalized && !options.includes(normalized) && !value.includes(normalized) ? (
            <button type="button" className="w-full rounded-md px-2 py-2 text-left text-[11px] hover:bg-muted" onMouseDown={(event) => event.preventDefault()} onClick={() => add(normalized)}>
              Add custom <code className="ml-1">{normalized}</code>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
