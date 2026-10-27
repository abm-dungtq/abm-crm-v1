import {
  createContext, useCallback, useContext, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Link } from '@tanstack/react-router';
import { ACTIVE_STAGES, LEARNER_STAGES, stageLabel, type StageCode } from '@abm/contracts';
import { ApiFailure } from '../api';
import { fmtHours, fmtMoney, initials } from '../format';
import type { LeadHealth } from '../types';
import { useFloatingStyle } from './floating';
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

export function Avatar({ name, size, src }: { name: string | null | undefined; size?: 'lg' | 'sm'; src?: string | null }) {
  const [broken, setBroken] = useState<string | null>(null);
  const showImage = Boolean(src) && broken !== src;
  return (
    <span className={`avatar${size ? ` ${size}` : ''}`} title={name ?? undefined} aria-hidden="true">
      {showImage
        ? <img src={src!} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(src!)} />
        : initials(name)}
    </span>
  );
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
  // What had focus when the dialog opened; focus goes back there on close, also when the caller unmounts the dialog.
  const openerRef = useRef<HTMLElement | null>(null);
  // A close made by the cleanup below is not the person closing the dialog: its "close" event must not call onClose.
  // (React's development double run of effects closes and reopens a dialog that mounts open.)
  const silentCloseRef = useRef(false);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const dialog = ref.current;
    return () => {
      // Close first: while the modal is open everything outside it is inert and cannot take focus.
      if (dialog?.open) {
        silentCloseRef.current = true;
        dialog.close();
      }
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener && opener.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
    };
  }, [open]);
  return (
    // React passes close/cancel up its own tree, so a dialog opened inside this one (a confirm step) must not close it.
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      onClose={(e) => {
        if (e.target !== e.currentTarget) return;
        if (silentCloseRef.current) {
          silentCloseRef.current = false;
          return;
        }
        onClose();
      }}
      onCancel={(e) => { if (e.target !== e.currentTarget) return; e.preventDefault(); onClose(); }}
    >
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

export function Field({
  label,
  required,
  error,
  hint,
  counter,
  children,
  htmlFor,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  counter?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  const msg = error ? <span className="field-error" role="alert">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null;
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}{required && <span className="req" aria-hidden="true"> *</span>}</label>
      {children}
      {counter ? <div className="field-foot">{msg ?? <span />}{counter}</div> : msg}
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

/**
 * A confirm step for a destructive or far-reaching action. The body names the object and the consequence; the confirm
 * button repeats the verb. Focus starts on "Hủy", so Enter alone never confirms.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  tone = 'danger',
  pending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Runs after Modal's own effect has called showModal(), so the button is focusable.
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button ref={cancelRef} type="button" className="btn" onClick={onCancel}>Hủy</button>
          <button
            type="button"
            className={`btn ${tone === 'danger' ? 'btn-danger-solid' : 'btn-primary'}`}
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? 'Đang thực hiện…' : confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-2">{children}</div>
    </Modal>
  );
}

export interface OverflowMenuItem {
  label: string;
  icon?: IconName;
  disabled?: boolean;
  /** Shown last, after a divider, in the danger colour. */
  danger?: boolean;
  onSelect: () => void;
}

/** An item's height on a touch screen plus the gap, so the height cap never cuts a short menu. */
const MENU_ITEM_PX = 46;

/**
 * The "⋯" button and its menu. The menu renders in a portal (inside the open dialog, when there is one) at a fixed
 * position under the button, or above it when there is no room below, so a scrolling list never clips it. Arrow keys,
 * Home and End move between items. It closes on a choice, an outside press, Tab or Escape; after a choice or Escape
 * focus is back on the button, so a dialog opened from an item can return focus there. Pass `open`/`onOpenChange` to
 * control it, e.g. to open it from a long-press.
 */
export function OverflowMenu({
  label,
  items,
  align = 'right',
  className,
  buttonClassName = 'btn btn-ghost btn-sm icon-btn',
  open: controlledOpen,
  onOpenChange,
}: {
  label: string;
  items: OverflowMenuItem[];
  align?: 'left' | 'right';
  className?: string;
  buttonClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = useCallback((next: boolean) => {
    if (controlledOpen === undefined) setOwnOpen(next);
    onOpenChange?.(next);
  }, [controlledOpen, onOpenChange]);
  const boxRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLSpanElement>(null);
  const menuId = useId();
  const regular = items.filter((i) => !i.danger);
  const danger = items.filter((i) => i.danger);
  const style = useFloatingStyle(buttonRef, open, {
    minWidth: 180,
    maxHeight: Math.min(320, items.length * MENU_ITEM_PX + 24),
    align: align === 'right' ? 'end' : 'start',
    matchWidth: false,
  });

  useEffect(() => {
    if (!open) return;
    // Capture phase: a parent that stops propagation (a draggable card) cannot hide the press from this menu, and
    // opening another menu closes this one.
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!boxRef.current?.contains(target) && !popRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    popRef.current?.querySelector<HTMLButtonElement>('.menu-item:not(:disabled)')?.focus({ preventScroll: true });
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open, setOpen]);

  const closeToButton = () => {
    setOpen(false);
    buttonRef.current?.focus({ preventScroll: true });
  };

  const onMenuKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      // Handled here, not on the document: a parent that stops key events would hide it, and a dialog must stay open.
      e.preventDefault();
      e.stopPropagation();
      closeToButton();
      return;
    }
    if (e.key === 'Tab') {
      // Focus goes to the button first, so Tab moves on from there.
      closeToButton();
      return;
    }
    const enabled = [...(popRef.current?.querySelectorAll<HTMLButtonElement>('.menu-item:not(:disabled)') ?? [])];
    if (!enabled.length) return;
    const at = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? (at + 1) % enabled.length
      : e.key === 'ArrowUp' ? (at - 1 + enabled.length) % enabled.length
        : e.key === 'Home' ? 0
          : e.key === 'End' ? enabled.length - 1
            : -1;
    if (next < 0) return;
    e.preventDefault();
    enabled[next]!.focus({ preventScroll: true });
  };

  const renderItem = (item: OverflowMenuItem) => (
    <button
      key={item.label}
      type="button"
      role="menuitem"
      className="menu-item"
      data-tone={item.danger ? 'danger' : undefined}
      disabled={item.disabled}
      onClick={() => {
        closeToButton();
        item.onSelect();
      }}
    >
      {item.icon && <Icon name={item.icon} />}
      {item.label}
    </button>
  );

  const host = open && buttonRef.current ? (buttonRef.current.closest('dialog') ?? document.body) : null;

  return (
    <span
      className={`dropdown${className ? ` ${className}` : ''}`}
      data-align={align}
      data-open={open ? 'true' : undefined}
      ref={boxRef}
    >
      <button
        ref={buttonRef}
        type="button"
        className={buttonClassName}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Icon name="more" />
      </button>
      {host && createPortal(
        <span
          ref={popRef}
          id={menuId}
          className="menu-pop menu-floating"
          role="menu"
          aria-label={label}
          // The placed style lands before paint; it is never hidden meanwhile, so the first item can take focus.
          style={style ?? { position: 'fixed' }}
          onKeyDown={onMenuKey}
        >
          {regular.map(renderItem)}
          {regular.length > 0 && danger.length > 0 && <span className="menu-sep" role="separator" />}
          {danger.map(renderItem)}
        </span>,
        host,
      )}
    </span>
  );
}

// ---------- toast ----------
/** An optional link inside a toast, e.g. "Mở việc" after creating a task. */
export interface ToastAction { label: string; to: string }
type ToastTone = 'danger';
type ToastItem = { id: number; text: ReactNode; tone?: ToastTone; action?: ToastAction };
type PushToast = (text: ReactNode, tone?: ToastTone, action?: ToastAction) => void;
const ToastContext = createContext<PushToast>(() => {});
export const useToast = () => useContext(ToastContext);

const TOAST_MS = 4500;
/** A toast with a link stays longer so there is time to reach it. */
const TOAST_ACTION_MS = 8000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback<PushToast>((text, tone, action) => {
    const id = Date.now() + Math.random();
    setItems((list) => [...list, { id, text, tone, action }]);
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), action ? TOAST_ACTION_MS : TOAST_MS);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="toast" data-tone={t.tone}>
            <span>{t.text}</span>
            {t.action && (
              <Link
                className="toast-action"
                to={t.action.to as '/'}
                onClick={() => setItems((list) => list.filter((x) => x.id !== t.id))}
              >
                {t.action.label}
              </Link>
            )}
          </div>
        ))}
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
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  size?: 'sm' | 'md';
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div className={`seg-control seg-${size}${className ? ` ${className}` : ''}`} role="group" aria-label={ariaLabel}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            className={`seg-btn${active ? ' active' : ''}`}
            data-tone={active ? (opt.tone ?? 'neutral') : undefined}
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

export function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string | null;
  alt?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [src, onClose]);

  if (!src) return null;

  return (
    <div
      className="lightbox-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={alt || 'Xem ảnh lớn'}
      onClick={onClose}
    >
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="lightbox-open-original"
        >
          <Icon name="external-link" />
          <span>Mở ảnh gốc</span>
        </a>
        <button
          type="button"
          className="lightbox-close"
          onClick={onClose}
          aria-label="Đóng"
          title="Đóng (Esc)"
        >
          <Icon name="close" />
        </button>
      </div>
      <img
        src={src}
        alt={alt || 'Ảnh phóng to'}
        className="lightbox-img"
        referrerPolicy="no-referrer"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

