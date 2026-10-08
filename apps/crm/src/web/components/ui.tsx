import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { ACTIVE_STAGES, stageLabel, type StageCode } from '@abm/contracts';
import { ApiFailure } from '../api';
import { fmtHours, initials } from '../format';
import type { LeadHealth } from '../types';
import { Icon, type IconName } from './icons';

export type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'info' | 'agent';

export function Badge({ tone = 'neutral', dot, children, title }: { tone?: Tone; dot?: boolean; children: ReactNode; title?: string }) {
  return <span className="badge" data-tone={tone} title={title}>{dot && <span className="dot" />}{children}</span>;
}

export function StageBadge({ stage }: { stage: StageCode | string }) {
  if (stage === 'won') return <Badge tone="ok" dot>Won</Badge>;
  if (stage === 'lost') return <Badge tone="danger" dot>Lost</Badge>;
  const index = ACTIVE_STAGES.indexOf(stage as StageCode);
  return (
    <span className="badge badge-stage">
      <span className="pips" aria-hidden="true">
        {ACTIVE_STAGES.map((s, i) => <span key={s} className={`pip${i <= index ? ' on' : ''}`} />)}
      </span>
      {stageLabel(stage)}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  if (status === 'queue') return <Badge tone="info" dot>Hàng chờ</Badge>;
  if (status === 'won') return <Badge tone="ok" dot>Won</Badge>;
  if (status === 'lost') return <Badge tone="danger" dot>Lost</Badge>;
  return <Badge tone="accent" dot>Đang mở</Badge>;
}

/** SLA signals for one lead; renders nothing when everything is on time. */
export function HealthBadges({ health, compact }: { health: LeadHealth; compact?: boolean }) {
  const items: ReactNode[] = [];
  const fc = health.firstContact;
  if (fc && fc.state !== 'ok') {
    const text = fc.state === 'release' ? 'Quá 24h chưa liên hệ' : fc.state === 'breach' ? 'Trễ liên hệ đầu' : 'Sắp trễ liên hệ đầu';
    items.push(<Badge key="fc" tone={fc.state === 'warn' ? 'warn' : 'danger'} title={`Đã ${fmtHours(fc.minutes)} làm việc từ khi giao`}>{text}</Badge>);
  }
  if (health.nextActionOverdue) items.push(<Badge key="na" tone="danger">Next Action quá hạn</Badge>);
  const sla = health.stageSla;
  if (sla && sla.state !== 'ok') {
    items.push(
      <Badge key="sla" tone={sla.state === 'breach' ? 'danger' : 'warn'} title={`${sla.days}/${sla.limit} ngày làm việc ở stage này`}>
        {compact ? `Stage ${sla.days}/${sla.limit}n` : sla.state === 'breach' ? `Quá SLA stage (${sla.days}/${sla.limit} ngày)` : `Gần hạn SLA stage (${sla.days}/${sla.limit})`}
      </Badge>,
    );
  }
  return items.length ? <span className="health">{items}</span> : null;
}

export function Avatar({ name, size }: { name: string | null | undefined; size?: 'lg' }) {
  return <span className={`avatar${size ? ` ${size}` : ''}`} title={name ?? undefined} aria-hidden="true">{initials(name)}</span>;
}

export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-label="Đang tải">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ height: 44 }} />)}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof ApiFailure ? error.message : 'Có lỗi khi tải dữ liệu.';
  return (
    <div className="alert" data-tone="danger" role="alert">
      <Icon name="alert" />
      <div className="row-wrap">
        <span>{message}</span>
        {onRetry && <button className="btn btn-sm" onClick={onRetry}>Thử lại</button>}
      </div>
    </div>
  );
}

export function Empty({ title, children, icon = 'inbox' }: { title: string; children?: ReactNode; icon?: IconName }) {
  return (
    <div className="empty">
      <Icon name={icon} style={{ width: 28, height: 28, marginBottom: 6 }} />
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function Alert({ tone, children }: { tone: 'danger' | 'warn' | 'info' | 'ok'; children: ReactNode }) {
  return (
    <div className="alert" data-tone={tone} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon name={tone === 'info' || tone === 'ok' ? 'info' : 'alert'} />
      <div>{children}</div>
    </div>
  );
}

/** Native <dialog> for focus trapping, Esc to close and inert background. */
export function Modal({ open, title, onClose, children, footer }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} className="modal" aria-labelledby={titleId} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      {open && (
        <>
          <div className="modal-head">
            <h2 id={titleId}>{title}</h2>
            <span className="spacer" />
            <button className="btn btn-ghost icon-btn" onClick={onClose} aria-label="Đóng"><Icon name="close" /></button>
          </div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-foot">{footer}</div>}
        </>
      )}
    </dialog>
  );
}

export function Field({ label, required, error, hint, children, htmlFor }: { label: string; required?: boolean; error?: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}{required && <span className="req" aria-hidden="true"> *</span>}</label>
      {children}
      {error ? <span className="field-error" role="alert">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

/** Field errors from a VALIDATION_FAILED response, keyed by schema path. */
export function fieldErrors(error: unknown): Record<string, string> {
  return error instanceof ApiFailure && error.error.fields ? error.error.fields : {};
}

/** Error line for a form; validation details render next to their fields instead. */
export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  if (error instanceof ApiFailure && error.code === 'STALE_VERSION') {
    return <Alert tone="warn">{error.message} Màn hình đã được tải lại với dữ liệu mới.</Alert>;
  }
  return <Alert tone="danger">{error instanceof ApiFailure ? error.message : 'Không thực hiện được. Thử lại.'}</Alert>;
}

// ---------- toast ----------
type ToastItem = { id: number; text: string; tone?: 'danger' };
const ToastContext = createContext<(text: string, tone?: 'danger') => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, tone?: 'danger') => {
    const id = Date.now() + Math.random();
    setItems((list) => [...list, { id, text, tone }]);
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 4000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className="toast" data-tone={t.tone}>{t.text}</div>)}
      </div>
    </ToastContext.Provider>
  );
}

export function Kpi({ label, value, note, tone, to, search }: { label: string; value: ReactNode; note?: ReactNode; tone?: 'danger' | 'warn'; to?: string; search?: Record<string, string> }) {
  const body = (
    <>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {note && <span className="kpi-note">{note}</span>}
    </>
  );
  return to
    ? <Link className="card kpi" to={to as '/'} search={search as never} data-tone={tone}>{body}</Link>
    : <div className="card kpi" data-tone={tone}>{body}</div>;
}

/** `value` once it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const t = setTimeout(() => setDebounced(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return debounced;
}
