import { useId, type KeyboardEvent, type ReactNode } from 'react';

/** Automatic activation for an existing tabstrip that owns its own panels. */
export function handleTabKeys(event: KeyboardEvent<HTMLElement>) {
  const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const index = tabs.indexOf(event.target as HTMLButtonElement);
  if (index < 0 || !tabs.length) return;
  const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
  if (next < 0) return;
  event.preventDefault();
  tabs[next]?.click();
  tabs[next]?.focus();
}

export function Tabs<T extends string | number>({ label, options, value, onChange, children, className = '' }: {
  label: string;
  options: Array<{ value: T; label: ReactNode }>;
  value: T;
  onChange: (value: T) => void;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  return <div className={`tab-view ${className}`}>
    <div className="segmented" role="tablist" aria-label={label} onKeyDown={(event) => {
      const focused = [...event.currentTarget.querySelectorAll('[role="tab"]')].indexOf(event.target as HTMLElement);
      const current = focused >= 0 ? focused : index;
      let next: number;
      if (event.key === 'ArrowRight') next = (current + 1) % options.length;
      else if (event.key === 'ArrowLeft') next = (current + options.length - 1) % options.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = options.length - 1;
      else return;
      event.preventDefault();
      onChange(options[next]!.value);
      document.getElementById(`${id}-${next}`)?.focus();
    }}>
      {options.map((option, i) => <button key={option.value} id={`${id}-${i}`} type="button" role="tab"
        aria-selected={i === index} aria-controls={`${id}-panel`} tabIndex={i === index ? 0 : -1}
        className={`segmented__item${i === index ? ' segmented__item--active' : ''}`}
        onClick={() => onChange(option.value)}>{option.label}</button>)}
    </div>
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${index}`} className="tab-view__panel">{children}</div>
  </div>;
}
