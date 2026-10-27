import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import {
  QUICK_DUE_OPTIONS, WEEKDAYS, addDays, calendarWeeks, commitFieldText, dayLabel, dayValue, formatFieldValue,
  quickDueValue, splitFieldValue, vnNow, type DateFieldMode, type VnDay,
} from '../date-time';
import { useFloatingStyle } from './floating';
import { Icon } from './icons';

const TIME_CHOICES = ['08:00', '09:00', '11:00', '14:00', '17:00'];

const FORMAT_HINT: Record<DateFieldMode, string> = {
  date: 'Nhập ngày theo dạng ngày/tháng/năm, ví dụ 30/10/2026.',
  datetime: 'Nhập theo dạng ngày/tháng/năm giờ:phút, giờ 24 tiếng, ví dụ 30/10/2026 09:00.',
};

/**
 * A Vietnamese date or date-time field: typed as "30/10/2026 09:00" (or shorter, "31/10 14h"), or picked on a
 * Monday-first calendar. `value` and `onChange` use the field value shape from `date-time.ts`, '' when empty.
 * An entry that cannot be read is not applied: on leaving the field the last valid value comes back with a message.
 */
export function DateTimeField({
  id,
  value,
  onChange,
  mode = 'datetime',
  required,
  invalid,
  disabled,
  quickPicks,
  clearLabel,
  ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  mode?: DateFieldMode;
  required?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  /** Shows the quick due chips (Hôm nay 17:00, Sáng mai 9:00, +3 ngày, +1 tuần) under the field. */
  quickPicks?: boolean;
  /** Shows a button with this label that empties the field, e.g. "Bỏ hạn". */
  clearLabel?: string;
  /** Accessible name when no visible <label htmlFor> points at the field. */
  ariaLabel?: string;
}) {
  const autoId = useId();
  const inputId = id ?? `${autoId}-input`;
  const hintId = `${autoId}-hint`;
  const errorId = `${autoId}-error`;
  const [text, setText] = useState(() => formatFieldValue(value));
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const controlRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // The value when the field gained focus (or was last committed with Enter): an unreadable entry goes back to it.
  const focusValueRef = useRef(value);

  // Follow outside changes (quick picks, a reset after saving) unless the person is typing.
  useEffect(() => {
    if (!focused) setText(formatFieldValue(value));
  }, [value, focused]);

  // Typing only edits the text; the value changes on blur, on Enter, or from the calendar and quick picks.
  const handleType = (next: string) => {
    setText(next);
    setError(null);
  };

  const commit = (leaving: boolean) => {
    if (leaving) setFocused(false);
    const result = commitFieldText(text, { mode, revertTo: focusValueRef.current });
    setText(result.text);
    if (!result.ok) setError(`Không đọc được “${text.trim()}”. ${FORMAT_HINT[mode]}`);
    else setError(null);
    if (result.value !== value) onChange(result.value);
    focusValueRef.current = result.value;
  };

  const pick = (next: string) => {
    setError(null);
    onChange(next);
    setText(formatFieldValue(next));
    focusValueRef.current = next;
  };

  const describedBy = [hintId, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className="dtf">
      <div className="row" style={{ gap: 6 }}>
        <div className="dtf-control" ref={controlRef} data-mode={mode}>
          <input
            id={inputId}
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={text}
            placeholder={mode === 'date' ? 'dd/mm/yyyy' : 'dd/mm/yyyy hh:mm'}
            required={required}
            disabled={disabled}
            aria-label={ariaLabel}
            aria-invalid={invalid || Boolean(error) || undefined}
            aria-describedby={describedBy}
            onFocus={() => {
              setFocused(true);
              focusValueRef.current = value;
            }}
            onBlur={() => commit(true)}
            onChange={(e) => handleType(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit(false);
              } else if (e.key === 'Escape' && open) {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
              } else if (e.key === 'ArrowDown' && e.altKey) {
                e.preventDefault();
                setOpen(true);
              }
            }}
          />
          <button
            ref={buttonRef}
            type="button"
            className="dtf-btn"
            aria-label={mode === 'date' ? 'Chọn ngày trên lịch' : 'Chọn ngày giờ trên lịch'}
            title="Mở lịch"
            aria-haspopup="dialog"
            aria-expanded={open}
            disabled={disabled}
            onClick={() => setOpen((v) => !v)}
          >
            <Icon name="calendar" />
          </button>
        </div>
        {clearLabel && value && !disabled && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => pick('')}>
            {clearLabel}
          </button>
        )}
      </div>
      <span id={hintId} className="visually-hidden">{FORMAT_HINT[mode]}</span>
      {error && <span id={errorId} className="field-error" role="alert">{error}</span>}
      {quickPicks && !disabled && (
        <div className="chips" role="group" aria-label="Chọn nhanh hạn">
          {QUICK_DUE_OPTIONS.map((q) => {
            const v = quickDueValue(q.days, q.hour);
            return (
              <button type="button" key={q.label} className="chip" aria-pressed={value === v} onClick={() => pick(v)}>
                {q.label}
              </button>
            );
          })}
        </div>
      )}
      {open && (
        <CalendarPopup
          anchorRef={controlRef}
          mode={mode}
          value={value}
          onPick={(next, close) => {
            pick(next);
            if (close) setOpen(false);
          }}
          onClose={(restoreFocus) => {
            setOpen(false);
            if (restoreFocus) buttonRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}

function CalendarPopup({
  anchorRef,
  mode,
  value,
  onPick,
  onClose,
}: {
  anchorRef: RefObject<HTMLDivElement | null>;
  mode: DateFieldMode;
  value: string;
  onPick: (value: string, close: boolean) => void;
  onClose: (restoreFocus: boolean) => void;
}) {
  const titleId = useId();
  const popRef = useRef<HTMLDivElement>(null);
  const style = useFloatingStyle(anchorRef, true, { minWidth: 292, maxHeight: 460 });
  const selected = splitFieldValue(value);
  const today = vnNow();
  const [focusDay, setFocusDay] = useState<VnDay>(selected?.day ?? today);
  const [view, setView] = useState({ year: focusDay.year, month: focusDay.month });
  // Bumped when keyboard focus should follow the focused day: on open and on arrow keys, not on the month buttons.
  const [focusTick, setFocusTick] = useState(1);
  const time = selected?.time ?? '09:00';

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!popRef.current?.contains(target) && !anchorRef.current?.contains(target)) onClose(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [anchorRef, onClose]);

  useEffect(() => {
    popRef.current?.querySelector<HTMLButtonElement>(`[data-day="${dayValue(focusDay)}"]:not([data-outside])`)?.focus();
  }, [focusTick]);

  const moveFocus = (next: VnDay) => {
    setFocusDay(next);
    setFocusTick((n) => n + 1);
    if (next.month !== view.month || next.year !== view.year) setView({ year: next.year, month: next.month });
  };
  const shiftMonth = (delta: number) => {
    const d = new Date(Date.UTC(view.year, view.month - 1 + delta, 1));
    setView({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
  };

  const chooseDay = (d: VnDay) => onPick(mode === 'date' ? dayValue(d) : `${dayValue(d)}T${time}`, mode === 'date');

  const onGridKey = (e: KeyboardEvent) => {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in steps) {
      e.preventDefault();
      moveFocus(addDays(focusDay, steps[e.key]!));
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      const d = new Date(Date.UTC(focusDay.year, focusDay.month - 1 + (e.key === 'PageUp' ? -1 : 1), 1));
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth() + 1;
      moveFocus({ year: y, month: m, day: Math.min(focusDay.day, new Date(Date.UTC(y, m, 0)).getUTCDate()) });
    }
  };

  const selectedKey = selected ? dayValue(selected.day) : null;
  const todayKey = dayValue(today);
  const focusKey = dayValue(focusDay);
  const focusInView = focusDay.month === view.month && focusDay.year === view.year;

  return (
    <div
      ref={popRef}
      className="dtf-pop"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      style={style ?? { position: 'fixed', visibility: 'hidden' }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose(true);
        }
      }}
      onBlur={(e) => {
        const next = e.relatedTarget as Node | null;
        if (next && !popRef.current?.contains(next) && !anchorRef.current?.contains(next)) onClose(false);
      }}
    >
      <div className="dtf-pop-head">
        <button type="button" className="btn btn-ghost btn-sm icon-btn" aria-label="Tháng trước" onClick={() => shiftMonth(-1)}>
          <Icon name="chevron-left" />
        </button>
        <strong id={titleId} aria-live="polite">Tháng {view.month} năm {view.year}</strong>
        <button type="button" className="btn btn-ghost btn-sm icon-btn" aria-label="Tháng sau" onClick={() => shiftMonth(1)}>
          <Icon name="chevron-right" />
        </button>
      </div>
      <table className="dtf-grid" role="grid" aria-labelledby={titleId} onKeyDown={onGridKey}>
        <thead>
          <tr>
            {WEEKDAYS.map((w) => (
              <th key={w.short} scope="col" abbr={w.long}>{w.short}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {calendarWeeks(view.year, view.month).map((week, i) => (
            <tr key={i}>
              {week.map((d) => {
                const key = dayValue(d);
                // One day is in the tab order: the focused day when it is in this month, else the 1st.
                const tabbable = focusInView ? key === focusKey : d.inMonth && d.day === 1;
                return (
                  <td key={key}>
                    <button
                      type="button"
                      className="dtf-day"
                      data-day={key}
                      data-outside={!d.inMonth || undefined}
                      data-today={key === todayKey || undefined}
                      aria-label={dayLabel(d)}
                      aria-pressed={key === selectedKey}
                      aria-current={key === todayKey ? 'date' : undefined}
                      tabIndex={tabbable ? 0 : -1}
                      onClick={() => {
                        setFocusDay(d);
                        chooseDay(d);
                      }}
                    >
                      {d.day}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {mode === 'datetime' && (
        <div className="dtf-times">
          <span className="small muted" id={`${titleId}-time`}>Giờ</span>
          <div className="chips" role="group" aria-labelledby={`${titleId}-time`}>
            {TIME_CHOICES.map((t) => (
              <button
                key={t}
                type="button"
                className="chip"
                aria-pressed={Boolean(selected) && time === t}
                onClick={() => onPick(`${selected ? dayValue(selected.day) : todayKey}T${t}`, false)}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="dtf-pop-foot">
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => moveFocus(today)}>
          Hôm nay
        </button>
        <span className="spacer" />
        <button type="button" className="btn btn-sm" onClick={() => onClose(true)}>
          Xong
        </button>
      </div>
    </div>
  );
}
