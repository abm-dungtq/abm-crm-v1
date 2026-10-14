import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { ACTIVE_STAGES, LEARNER_STAGES, stageLabel, type StageCode } from '@abm/contracts';
import { ApiFailure } from '../api';
import { fmtHours, fmtMoney, initials } from '../format';
import type { LeadHealth } from '../types';
import { Icon, type IconName } from './icons';

export type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'info' | 'agent';

export function Badge({ tone = 'neutral', dot, children, title }: { tone?: Tone; dot?: boolean; children: ReactNode; title?: string }) {
  return <span className="badge" data-tone={tone} title={title}>{dot && <span className="dot" />}{children}</span>;
}

const ACTIVE_LEARNER_STAGES = LEARNER_STAGES.filter((s) => !['won', 'lost', 'not_fit'].includes(s.code)).map((s) => s.code);

export function StageBadge({ stage, pipeline }: { stage: StageCode | string; pipeline?: 'b2b' | 'learner' | string }) {
  const isLearner = pipeline === 'learner' || stage === 'trial_booked' || stage === 'trial_done' || stage === 'not_fit';
  if (stage === 'won') return <Badge tone="ok" dot>{isLearner ? 'Đã chốt' : 'Won'}</Badge>;
  if (stage === 'lost') return <Badge tone="danger" dot>{isLearner ? 'Mất' : 'Lost'}</Badge>;
  if (stage === 'not_fit') return <Badge tone="neutral" dot>Không hợp</Badge>;
  const stages = isLearner ? ACTIVE_LEARNER_STAGES : ACTIVE_STAGES;
  const index = stages.indexOf(stage as never);
  const label = isLearner ? (LEARNER_STAGES.find((s) => s.code === stage)?.label ?? stageLabel(stage)) : stageLabel(stage);
  return (
    <span className="badge badge-stage">
      <span className="pips" aria-hidden="true">
        {stages.map((s, i) => <span key={s} className={`pip${i <= index ? ' on' : ''}`} />)}
      </span>
      {label}
    </span>
  );
}

export function PipelineBadge({ pipeline }: { pipeline?: 'b2b' | 'learner' | string }) {
  if (pipeline === 'learner') return <Badge tone="agent">Học viên</Badge>;
  return <Badge tone="info">B2B</Badge>;
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

export function Avatar({ name, size }: { name: string | null | undefined; size?: 'lg' | 'sm' }) {
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
type ToastItem = { id: number; text: ReactNode; tone?: 'danger' };
const ToastContext = createContext<(text: ReactNode, tone?: 'danger') => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: ReactNode, tone?: 'danger') => {
    const id = Date.now() + Math.random();
    setItems((list) => [...list, { id, text, tone }]);
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 4500);
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

// ---------- Direction 3 shared components (Task 2.1) ----------

export function ChannelBadge({
  channel,
  kind,
  accountName,
  compact,
}: {
  channel: 'zalo_oa' | 'zalo' | 'facebook' | 'zalo_group' | string;
  kind?: 'direct' | 'group';
  accountName?: string | null;
  compact?: boolean;
}) {
  const resolved = kind === 'group' || channel === 'zalo_group' ? 'zalo_group' : channel;
  const meta: Record<string, { label: string; icon: IconName }> = {
    zalo_oa: { label: 'Zalo OA', icon: 'zalo-oa' },
    zalo: { label: 'Zalo', icon: 'zalo' },
    zalo_group: { label: 'Nhóm Zalo', icon: 'users' },
    facebook: { label: 'Messenger', icon: 'facebook' },
  };
  const info = meta[resolved] ?? { label: channel, icon: 'message' as IconName };
  const text = !compact && accountName ? `${info.label} · ${accountName}` : info.label;
  return (
    <span className="channel-badge" data-channel={resolved} title={accountName ? `${info.label}: ${accountName}` : info.label}>
      <Icon name={info.icon} style={{ width: 12, height: 12 }} />
      <span>{text}</span>
    </span>
  );
}

export function Drawer({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="drawer-backdrop" onClick={onClose} role="presentation">
      <aside className="drawer" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h3>{title}</h3>
          <span className="spacer" />
          <button type="button" className="btn btn-ghost icon-btn" onClick={onClose} aria-label="Đóng">
            <Icon name="close" />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </aside>
    </div>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: IconName;
  tone?: 'ai' | 'brand' | 'neutral';
  count?: number;
  disabled?: boolean;
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  size?: 'sm' | 'md';
  ariaLabel?: string;
}) {
  return (
    <div className={`seg-control seg-${size}`} role="group" aria-label={ariaLabel}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            className={`seg-btn${active ? ' active' : ''}`}
            data-tone={active ? (opt.tone ?? 'brand') : undefined}
            aria-pressed={active}
            disabled={opt.disabled}
            onClick={() => onChange(opt.value)}
          >
            {opt.icon && <Icon name={opt.icon} style={{ width: 13, height: 13 }} />}
            <span>{opt.label}</span>
            {opt.count !== undefined && <span className="seg-count">{opt.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  sub,
  tone = 'neutral',
  icon,
  to,
  search,
  compact,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'neutral' | 'brand' | 'ok' | 'warn' | 'danger' | 'ai';
  icon?: IconName;
  to?: string;
  search?: Record<string, string>;
  compact?: boolean;
}) {
  const inner = (
    <>
      <div className="kpi-card-head">
        <span className="kpi-card-label">{label}</span>
        {icon && <Icon name={icon} className="kpi-card-icon" />}
      </div>
      <div className="kpi-card-val-row">
        <span className="kpi-card-value">{value}</span>
        {sub && <span className="kpi-card-sub">{sub}</span>}
      </div>
    </>
  );
  const cls = `kpi-card${compact ? ' kpi-card-compact' : ''}`;
  return to ? (
    <Link className={cls} to={to as '/'} search={search as never} data-tone={tone}>
      {inner}
    </Link>
  ) : (
    <div className={cls} data-tone={tone}>
      {inner}
    </div>
  );
}

export interface LinkedLeadCardLead {
  id: string;
  code: string;
  pipeline?: 'b2b' | 'learner' | string;
  stage: StageCode | string;
  status: string;
  contactId?: string;
  contactName?: string;
  owner?: { id: string; name: string | null } | null;
  productName?: string | null;
  courseName?: string | null;
  expectedValue?: number | null;
  needSummary?: string | null;
}

export function LinkedLeadCard({ lead }: { lead: LinkedLeadCardLead }) {
  const isLearner = lead.pipeline === 'learner';
  const programText = [lead.productName, lead.courseName].filter(Boolean).join(' · ');
  return (
    <div className="linked-lead-card">
      <div className="linked-lead-top">
        <span className="code">{lead.code}</span>
        <PipelineBadge pipeline={lead.pipeline} />
        <StageBadge stage={lead.stage} pipeline={lead.pipeline} />
        <span className="spacer" />
        {isLearner && lead.contactId ? (
          <Link className="btn btn-sm btn-ghost" to="/learners/$contactId" params={{ contactId: lead.contactId }}>
            Hồ sơ HV <Icon name="external-link" style={{ width: 12, height: 12 }} />
          </Link>
        ) : (
          <Link className="btn btn-sm btn-ghost" to="/leads/$leadId" params={{ leadId: lead.id }}>
            Mở lead <Icon name="external-link" style={{ width: 12, height: 12 }} />
          </Link>
        )}
      </div>
      {programText && (
        <div className="linked-lead-program">
          <Icon name="layers" style={{ width: 13, height: 13 }} />
          <span>{programText}</span>
        </div>
      )}
      {lead.needSummary && <div className="linked-lead-need">{lead.needSummary}</div>}
      <div className="linked-lead-meta">
        <span>Phụ trách: <strong>{lead.owner?.name ?? 'Chưa giao'}</strong></span>
        {lead.expectedValue != null && lead.expectedValue > 0 && <span className="mono">{fmtMoney(lead.expectedValue, false)}</span>}
        {isLearner && (
          <Link className="muted" to="/leads/$leadId" params={{ leadId: lead.id }} style={{ marginLeft: 'auto', fontSize: 11.5 }}>
            Chi tiết {lead.code}
          </Link>
        )}
      </div>
    </div>
  );
}

export function QuickActionTile({
  icon,
  label,
  description,
  tone = 'neutral',
  onClick,
  disabled,
}: {
  icon: IconName;
  label: string;
  description?: string;
  tone?: 'brand' | 'ok' | 'warn' | 'ai' | 'neutral';
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" className="quick-action-tile" data-tone={tone} onClick={onClick} disabled={disabled}>
      <span className="quick-action-icon">
        <Icon name={icon} />
      </span>
      <span className="quick-action-text">
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
    </button>
  );
}

export function CopyableText({ value, label, mono = true }: { value: string; label?: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    if (!value) return;
    navigator.clipboard?.writeText(value).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [value]);
  return (
    <span className="copyable-text">
      <span className={mono ? 'mono' : undefined}>{label ?? value}</span>
      <button
        type="button"
        className="copyable-btn"
        onClick={copy}
        title={copied ? 'Đã sao chép' : `Sao chép ${value}`}
        aria-label={`Sao chép ${value}`}
      >
        <Icon name={copied ? 'check' : 'copy'} style={{ width: 13, height: 13 }} />
        {copied && <span className="copyable-feedback">Đã chép</span>}
      </button>
    </span>
  );
}

/** `value` once it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const t = setTimeout(() => setDebounced(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return debounced;
}
