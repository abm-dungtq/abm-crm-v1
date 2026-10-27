import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { matchesSearch } from '../text-search';
import { useFloatingStyle } from './floating';
import { Icon } from './icons';

export interface ComboOption {
  value: string;
  label: string;
  /** A second, quieter line: role and team, a company… */
  hint?: string;
  /** Extra text the option is found by, not shown. */
  keywords?: string;
}

const optionText = (o: ComboOption) => [o.label, o.hint, o.keywords].filter(Boolean).join(' ');

/**
 * The open/close state, highlighted option and keyboard handling shared by both comboboxes: arrows move, Enter picks,
 * Escape closes (or, when closed, does nothing so a surrounding dialog can close).
 */
function useComboList(options: ComboOption[], query: string, filter: boolean, onPick: (o: ComboOption) => void, isDisabled: (o: ComboOption) => boolean) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const shown = useMemo(
    () => (filter ? options.filter((o) => matchesSearch(optionText(o), query)) : options),
    [options, query, filter],
  );
  const activeIndex = shown.length ? Math.min(active, shown.length - 1) : -1;

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (!shown.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((activeIndex + step + shown.length) % shown.length);
    } else if (e.key === 'Home' && open && shown.length) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End' && open && shown.length) {
      e.preventDefault();
      setActive(shown.length - 1);
    } else if (e.key === 'Enter') {
      if (!open) return;
      e.preventDefault();
      const o = shown[activeIndex];
      if (o && !isDisabled(o)) onPick(o);
    } else if (e.key === 'Escape' && open) {
      // Keep the Escape here so a surrounding <dialog> stays open.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return { open, setOpen, shown, activeIndex, setActive, onKeyDown };
}

function OptionList({
  listId,
  anchorRef,
  shown,
  activeIndex,
  setActive,
  isSelected,
  isDisabled,
  onPick,
  multiselectable,
  status,
}: {
  listId: string;
  anchorRef: RefObject<HTMLDivElement | null>;
  shown: ComboOption[];
  activeIndex: number;
  setActive: (i: number) => void;
  isSelected: (o: ComboOption) => boolean;
  isDisabled: (o: ComboOption) => boolean;
  onPick: (o: ComboOption) => void;
  multiselectable?: boolean;
  /** Replaces the list: loading, nothing found. */
  status: ReactNode;
}) {
  const style = useFloatingStyle(anchorRef, true, { minWidth: 220, maxHeight: 300 });
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  return (
    <div className="combo-pop" style={style ?? { position: 'fixed', visibility: 'hidden' }}>
      {status ? (
        <div className="combo-status" role="status">{status}</div>
      ) : (
        <ul ref={listRef} id={listId} role="listbox" aria-multiselectable={multiselectable || undefined} className="combo-list">
          {shown.map((o, i) => {
            const selected = isSelected(o);
            const disabled = isDisabled(o);
            return (
              <li
                key={o.value}
                id={`${listId}-${i}`}
                data-index={i}
                role="option"
                aria-selected={selected}
                aria-disabled={disabled || undefined}
                data-active={i === activeIndex || undefined}
                className="combo-option"
                // Keep focus in the input so the list does not close before the click lands.
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => i !== activeIndex && setActive(i)}
                onClick={() => !disabled && onPick(o)}
              >
                <span className="combo-check" aria-hidden="true">{selected && <Icon name="check" />}</span>
                <span className="combo-text">
                  <span className="combo-label">{o.label}</span>
                  {o.hint && <span className="combo-hint">{o.hint}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const notFound = (query: string, empty?: string) =>
  query.trim() ? `Không tìm thấy “${query.trim()}”` : (empty ?? 'Không có lựa chọn');

/**
 * Searchable single select. Typing filters the options without caring about accents ("huy" finds "Bùi Quang Huy");
 * pass `filter={false}` with `onQueryChange` when the server filters (lead search). `selectedLabel` names a value that
 * is not among the current options.
 */
export function Combobox({
  id,
  options,
  value,
  onChange,
  placeholder,
  selectedLabel,
  emptyText,
  loading,
  invalid,
  disabled,
  filter = true,
  onQueryChange,
  clearLabel,
  ariaLabel,
}: {
  id?: string;
  options: ComboOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  selectedLabel?: string;
  emptyText?: string;
  loading?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  filter?: boolean;
  onQueryChange?: (query: string) => void;
  /** Shows a clear button (with this accessible name) while a value is chosen. */
  clearLabel?: string;
  ariaLabel?: string;
}) {
  const autoId = useId();
  const inputId = id ?? `${autoId}-input`;
  const listId = `${autoId}-list`;
  const [query, setQuery] = useState('');
  const [typing, setTyping] = useState(false);
  const controlRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const current = options.find((o) => o.value === value);
  const label = current?.label ?? selectedLabel ?? '';

  const reset = () => {
    setQuery('');
    setTyping(false);
    onQueryChange?.('');
  };
  const pick = (o: ComboOption) => {
    onChange(o.value);
    list.setOpen(false);
    reset();
  };
  const list = useComboList(options, typing ? query : '', filter, pick, () => false);

  // Start on the chosen option when the list opens.
  useEffect(() => {
    if (list.open && !typing) list.setActive(Math.max(0, list.shown.findIndex((o) => o.value === value)));
  }, [list.open]);

  const status = loading && !list.shown.length ? 'Đang tải…' : !list.shown.length ? notFound(typing ? query : '', emptyText) : null;

  return (
    <div className="combo" data-invalid={invalid || undefined}>
      <div className="combo-control" ref={controlRef}>
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-label={ariaLabel}
          aria-expanded={list.open}
          // Only point at the list while it is on the page.
          aria-controls={list.open && !status ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={list.open && list.activeIndex >= 0 && !status ? `${listId}-${list.activeIndex}` : undefined}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          placeholder={label || placeholder}
          value={typing ? query : label}
          onChange={(e) => {
            setQuery(e.target.value);
            setTyping(true);
            list.setActive(0);
            list.setOpen(true);
            onQueryChange?.(e.target.value);
          }}
          onClick={() => list.setOpen(true)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => {
            list.setOpen(false);
            reset();
          }}
          onKeyDown={list.onKeyDown}
        />
        {clearLabel && value && !disabled ? (
          <button
            type="button"
            className="combo-btn"
            aria-label={clearLabel}
            title={clearLabel}
            onClick={() => {
              onChange('');
              reset();
              inputRef.current?.focus();
            }}
          >
            <Icon name="close" />
          </button>
        ) : (
          <button
            type="button"
            className="combo-btn"
            tabIndex={-1}
            aria-label="Mở danh sách"
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              inputRef.current?.focus();
              list.setOpen(!list.open);
            }}
          >
            <Icon name="chevron-down" />
          </button>
        )}
      </div>
      {list.open && (
        <OptionList
          listId={listId}
          anchorRef={controlRef}
          shown={list.shown}
          activeIndex={list.activeIndex}
          setActive={list.setActive}
          isSelected={(o) => o.value === value}
          isDisabled={() => false}
          onPick={pick}
          status={status}
        />
      )}
    </div>
  );
}

/**
 * Searchable multi-select: chosen people show as removable tags above the field; Enter or a click toggles an option
 * and keeps the list open; Backspace in the empty field removes the last tag. Past `max`, other options are disabled.
 */
export function MultiCombobox({
  id,
  options,
  values,
  onChange,
  placeholder,
  emptyText,
  max,
  disabled,
  ariaLabel,
  tagListLabel,
}: {
  id?: string;
  options: ComboOption[];
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  emptyText?: string;
  max?: number;
  disabled?: boolean;
  ariaLabel?: string;
  /** Accessible name of the chosen tags, e.g. "Người cùng làm đã chọn". */
  tagListLabel: string;
}) {
  const autoId = useId();
  const inputId = id ?? `${autoId}-input`;
  const listId = `${autoId}-list`;
  const limitId = `${autoId}-limit`;
  const [query, setQuery] = useState('');
  const controlRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chosen = new Set(values);
  const full = max !== undefined && values.length >= max;
  const isDisabled = (o: ComboOption) => full && !chosen.has(o.value);

  const toggle = (o: ComboOption) => {
    if (chosen.has(o.value)) onChange(values.filter((v) => v !== o.value));
    else if (!full) onChange([...values, o.value]);
    setQuery('');
  };
  const list = useComboList(options, query, true, toggle, isDisabled);
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  const status = !list.shown.length ? notFound(query, emptyText) : null;

  return (
    <div className="combo combo-multi">
      {values.length > 0 && (
        <ul className="combo-tags" aria-label={tagListLabel}>
          {values.map((v) => (
            <li key={v} className="combo-tag">
              <span>{labelOf(v)}</span>
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Bỏ ${labelOf(v)}`}
                  title={`Bỏ ${labelOf(v)}`}
                  onClick={() => onChange(values.filter((x) => x !== v))}
                >
                  <Icon name="close" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="combo-control" ref={controlRef}>
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-label={ariaLabel}
          aria-expanded={list.open}
          // Only point at the list while it is on the page.
          aria-controls={list.open && !status ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={list.open && list.activeIndex >= 0 && !status ? `${listId}-${list.activeIndex}` : undefined}
          aria-describedby={full ? limitId : undefined}
          disabled={disabled}
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            list.setActive(0);
            list.setOpen(true);
          }}
          onClick={() => list.setOpen(true)}
          onBlur={() => {
            list.setOpen(false);
            setQuery('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !query && values.length) {
              onChange(values.slice(0, -1));
              return;
            }
            list.onKeyDown(e);
          }}
        />
        <button
          type="button"
          className="combo-btn"
          tabIndex={-1}
          aria-label="Mở danh sách"
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            inputRef.current?.focus();
            list.setOpen(!list.open);
          }}
        >
          <Icon name="chevron-down" />
        </button>
      </div>
      {full && <span id={limitId} className="field-hint">Đã chọn tối đa {max} người.</span>}
      {list.open && (
        <OptionList
          listId={listId}
          anchorRef={controlRef}
          shown={list.shown}
          activeIndex={list.activeIndex}
          setActive={list.setActive}
          isSelected={(o) => chosen.has(o.value)}
          isDisabled={isDisabled}
          onPick={toggle}
          multiselectable
          status={status}
        />
      )}
    </div>
  );
}
