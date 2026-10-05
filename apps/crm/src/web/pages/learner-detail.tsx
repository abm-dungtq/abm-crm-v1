import { useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import {
  LEARNER_JOURNEY, LEARNER_LOST_REASONS, PRIVACY_REQUEST_KINDS, activityLabel, enrollmentStatusLabel,
  type BookTrialInput, type CancelPendingEnrollmentInput, type ChangeCustomerOwnerInput, type CloseLearnerLeadInput,
  type CreatePrivacyRequestInput, type LearnerLostReasonCode, type MarkJourneyStepInput, type PrivacyRequestKind,
  type RecordConsentInput, type ReserveSeatInput, type SkipTrialInput, type WinLearnerLeadInput,
} from '@abm/contracts';
import { useActor } from '../actor-context';
import { useApi, useCommand } from '../api';
import { Icon } from '../components/icons';
import { LogActivityForm } from '../components/lead-actions';
import { Alert, Badge, Empty, ErrorState, Field, FormError, Loading, Modal, fieldErrors, useToast } from '../components/ui';
import { fmtDate, fmtDateTime, fmtDue, fmtMoney } from '../format';
import type { LearnerContact, LearnerDetail, LearnerLead, LearnerPermissions, LearnerProduct, ProductItem } from '../types';

export function LearnerDetailPage() {
  const { contactId } = useParams({ from: '/learners/$contactId' });
  const q = useApi<LearnerDetail>(`/learners/${contactId}`);
  if (q.isLoading) return <Loading rows={8} />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return q.data.restricted ? <RestrictedView detail={q.data} /> : <FullView detail={q.data} />;
}

function Header({ contact, children }: { contact: LearnerContact; children?: React.ReactNode }) {
  return (
    <div className="page-head" style={{ alignItems: 'flex-start' }}>
      <div style={{ minWidth: 0 }}>
        <div className="small"><Link to="/learners">Học viên</Link> / {contact.name}</div>
        <h1 className="truncate">{contact.name}</h1>
        <div className="row-wrap" style={{ marginTop: 6 }}>
          {contact.held ? <Badge tone="accent" dot>Đang giữ{contact.ownerName ? `: ${contact.ownerName}` : ''}</Badge> : <Badge tone="info" dot>Hồ chung</Badge>}
          {contact.holdExpiresAt && <span className="small muted">Giữ đến {fmtDate(contact.holdExpiresAt)}</span>}
        </div>
      </div>
      <div className="row-wrap">{children}</div>
    </div>
  );
}

function ClaimButton({ contact }: { contact: LearnerContact }) {
  const toast = useToast();
  const claim = useCommand<{ contactId: string; version: number }>('claimCustomer');
  return (
    <>
      <button className="btn btn-primary" disabled={claim.isPending}
        onClick={() => claim.mutate({ contactId: contact.id, version: contact.version }, { onSuccess: () => toast('Đã nhận khách') })}>Nhận khách</button>
      <FormError error={claim.error} />
    </>
  );
}

function PrivacyRequestButton({ contactId }: { contactId: string }) {
  const actor = useActor();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<PrivacyRequestKind>('access');
  const [detail, setDetail] = useState('');
  const m = useCommand<CreatePrivacyRequestInput>('createPrivacyRequest');
  if (actor.role !== 'sale' && actor.role !== 'leader' && actor.role !== 'admin') return null;
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}>Ghi yêu cầu dữ liệu cá nhân</button>
      {open && (
        <Modal open title="Ghi yêu cầu dữ liệu cá nhân" onClose={() => setOpen(false)} footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>Hủy</button>
            <button className="btn btn-primary" disabled={m.isPending}
              onClick={() => m.mutate(
                { contactId, kind, detail: detail.trim() || undefined },
                { onSuccess: () => { toast('Đã ghi yêu cầu'); setOpen(false); setDetail(''); } },
              )}>Ghi yêu cầu</button>
          </>
        }>
          <div className="stack">
            <Field label="Loại yêu cầu" htmlFor="privacy-kind" required>
              <select id="privacy-kind" value={kind} onChange={(e) => setKind(e.target.value as PrivacyRequestKind)}>
                {PRIVACY_REQUEST_KINDS.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
              </select>
            </Field>
            <Field label="Chi tiết" htmlFor="privacy-detail">
              <textarea id="privacy-detail" value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={1000} />
            </Field>
            <FormError error={m.error} />
          </div>
        </Modal>
      )}
    </>
  );
}

function RestrictedView({ detail }: { detail: Extract<LearnerDetail, { restricted: true }> }) {
  const { contact, summary, permissions } = detail;
  return (
    <>
      <Header contact={contact}>
        <PrivacyRequestButton contactId={contact.id} />
        {permissions.claim && <ClaimButton contact={contact} />}
      </Header>
      <div className="card" style={{ maxWidth: 560 }}>
        <div className="card-body stack">
          <Alert tone="info">
            {contact.held
              ? 'Khách này đang do sale khác giữ. Bạn chỉ thấy thông tin cơ bản, số điện thoại được ẩn.'
              : 'Khách đang ở hồ chung. Bấm Nhận khách để giữ 3 tháng và xem đầy đủ hồ sơ.'}
          </Alert>
          <dl className="dl">
            <dt>Họ tên</dt><dd>{contact.name}</dd>
            {summary && <><dt>Nguồn</dt><dd>{summary.sourceLabel}</dd><dt>Trạng thái</dt><dd>{summary.stageLabel}</dd></>}
            <dt>Điện thoại</dt><dd>{contact.phone ?? <span className="muted">Ẩn</span>}</dd>
          </dl>
        </div>
      </div>
    </>
  );
}

type Detail = Extract<LearnerDetail, { restricted: false }>;

function FullView({ detail }: { detail: Detail }) {
  const { contact, permissions } = detail;
  const [changing, setChanging] = useState(false);
  const activeLead = detail.leads.find((l) => l.status === 'active');
  const leadCodes = new Map(detail.leads.map((l) => [l.id, l.code]));
  return (
    <>
      <Header contact={contact}>
        <PrivacyRequestButton contactId={contact.id} />
        {permissions.claim && <ClaimButton contact={contact} />}
        {permissions.changeOwner && <button className="btn" onClick={() => setChanging(true)}><Icon name="swap" />Đổi sale</button>}
      </Header>
      <div className="cols-main">
        <div className="grid">
          {detail.leads.map((lead) => <LeadCard key={lead.id} lead={lead} canWork={permissions.work} />)}

          <section className="card" aria-labelledby="ln-act">
            <div className="card-head"><h2 id="ln-act">Nhật ký chăm sóc</h2><span className="spacer" /><span className="small muted">{detail.activities.length}</span></div>
            {permissions.work && activeLead && (
              <div className="card-body" style={{ borderBottom: '1px solid var(--border)' }}>
                <LogActivityForm leadId={activeLead.id} version={activeLead.version} firstContactMissing={false} />
              </div>
            )}
            <div className="card-body">
              {detail.activities.length === 0 ? <Empty title="Chưa có hoạt động" icon="note" /> : (
                <ol className="timeline">
                  {detail.activities.map((a) => (
                    <li key={a.id}>
                      <span className="tl-icon"><Icon name="note" /></span>
                      <div style={{ minWidth: 0 }}>
                        <div className="row-wrap">
                          <strong style={{ fontWeight: 600 }}>{activityLabel(a.type)}</strong>
                          <span className="mono small muted">{leadCodes.get(a.lead_id)}</span>
                          <span className="tl-meta">{a.actorName ?? 'Hệ thống'} · {fmtDateTime(a.occurredAt)}</span>
                        </div>
                        <p className="text-2" style={{ overflowWrap: 'anywhere' }}>{a.summary}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>
        </div>

        <div className="grid">
          <section className="card" aria-labelledby="ln-info">
            <div className="card-head"><h2 id="ln-info">Thông tin</h2></div>
            <div className="card-body">
              <dl className="dl">
                <dt>Điện thoại</dt><dd>{contact.phone ?? <span className="muted">—</span>}</dd>
                <dt>Email</dt><dd>{contact.email ?? <span className="muted">—</span>}</dd>
                <dt>Sale</dt><dd>{contact.ownerName ?? '—'}</dd>
                <dt>Giữ đến</dt><dd>{fmtDate(contact.holdExpiresAt)}</dd>
              </dl>
            </div>
          </section>
          <ProductsCard detail={detail} canWork={permissions.work} />
          <EnrollmentsCard detail={detail} canWork={permissions.work} />
          <ConsentCard detail={detail} canWork={permissions.work} />
        </div>
      </div>
      {changing && <ChangeOwnerDialog contact={contact} members={detail.ownerCandidates} permissions={permissions} onClose={() => setChanging(false)} />}
    </>
  );
}

// ---------- journey ----------

type StepAction = 'win' | 'close' | 'skip' | null;

function LeadCard({ lead, canWork }: { lead: LearnerLead; canWork: boolean }) {
  const toast = useToast();
  const [dialog, setDialog] = useState<StepAction>(null);
  const mark = useCommand<MarkJourneyStepInput>('markJourneyStep');
  const status = (code: string) => lead.steps.find((s) => s.code === code)?.status;
  const open = canWork && lead.status === 'active';
  const hand = (code: 'contacted' | 'need_confirmed') => mark.mutate({ leadId: lead.id, expectedVersion: lead.version, stepCode: code }, { onSuccess: () => toast('Đã cập nhật hành trình') });
  const canMark = (code: string) => open && status(code) === 'open'
    && (code === 'contacted' ? status('recorded') === 'done' : status('contacted') === 'done');
  const canSkip = open && status('trial') === 'open' && status('need_confirmed') === 'done';

  return (
    <section className="card" aria-labelledby={`lead-${lead.id}`}>
      <div className="card-head">
        <h2 id={`lead-${lead.id}`}><span className="mono">{lead.code}</span> · {lead.stageLabel}</h2>
        <span className="spacer" />
        <Badge tone={lead.status === 'won' ? 'ok' : lead.status === 'lost' ? 'danger' : 'accent'} dot>
          {lead.status === 'won' ? 'Thắng' : lead.status === 'lost' ? 'Đã đóng' : 'Đang mở'}
        </Badge>
      </div>
      <div className="card-body stack">
        <dl className="dl">
          <dt>Nguồn</dt><dd>{lead.sourceLabel}{lead.contract?.name ? ` · ${lead.contract.name}` : ''}</dd>
          <dt>Nhu cầu</dt><dd>{lead.needSummary}</dd>
          {lead.nextAction && lead.status === 'active' && <><dt>Next Action</dt><dd>{lead.nextAction.title} · {fmtDue(lead.nextAction.dueAt)}</dd></>}
          {lead.status === 'lost' && <><dt>Lý do</dt><dd>{lead.lostReason}{lead.lostNote ? `: ${lead.lostNote}` : ''}</dd></>}
          {lead.status === 'won' && lead.wonNote && <><dt>Ghi chú</dt><dd>{lead.wonNote}</dd></>}
        </dl>
        <ol className="list" aria-label="Hành trình" style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
          {lead.steps.map((s) => {
            const by = LEARNER_JOURNEY.find((j) => j.code === s.code)?.by;
            return (
              <li key={s.code} className="row">
                <Icon name={s.status === 'done' ? 'check' : s.status === 'skipped' ? 'arrow' : 'clock'}
                  style={{ width: 16, height: 16, color: s.status === 'done' ? 'var(--ok)' : 'var(--muted)' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div>{s.label}{!s.required && <span className="small muted"> (không bắt buộc)</span>}</div>
                  {s.status === 'skipped' && <div className="small muted">Bỏ qua: {s.skipReason}</div>}
                  {s.status === 'open' && by === 'auto' && <div className="small muted">Hệ thống tự cập nhật</div>}
                  {s.doneAt && <div className="small muted">{fmtDateTime(s.doneAt)}</div>}
                </div>
                {(s.code === 'contacted' || s.code === 'need_confirmed') && canMark(s.code) && (
                  <button className="btn btn-sm btn-primary" disabled={mark.isPending} onClick={() => hand(s.code as 'contacted' | 'need_confirmed')}>
                    {s.code === 'contacted' ? 'Đã liên hệ' : 'Xác nhận nhu cầu'}
                  </button>
                )}
                {s.code === 'trial' && canSkip && <button className="btn btn-sm" onClick={() => setDialog('skip')}>Bỏ qua học thử</button>}
              </li>
            );
          })}
        </ol>
        <FormError error={mark.error} />
        <div className="row-wrap">
          {open && lead.stage === 'qualified' && <BookTrialButton lead={lead} />}
          {canWork && lead.stage === 'won' && <ReserveButton lead={lead} />}
          {open && <button className="btn btn-primary" onClick={() => setDialog('win')}>Chốt thắng</button>}
          {open && <button className="btn btn-danger" onClick={() => setDialog('close')}>Mất / Không phù hợp</button>}
        </div>
      </div>
      {dialog === 'skip' && <SkipTrialDialog lead={lead} onClose={() => setDialog(null)} />}
      {dialog === 'win' && <WinDialog lead={lead} onClose={() => setDialog(null)} />}
      {dialog === 'close' && <CloseDialog lead={lead} onClose={() => setDialog(null)} />}
    </section>
  );
}

interface OpenClass {
  id: string; name: string; scheduleText: string | null; courseName: string; status?: string;
  trialSessions: { id: string; startsAt: string }[];
}
type CoursePick =
  | { scope: 'open'; classes: OpenClass[] }
  | { scope: 'manage'; courses: { name: string; classes: OpenClass[] }[] };

function pickClasses(data: CoursePick | undefined) {
  if (!data) return [];
  const rows = data.scope === 'open' ? data.classes : data.courses.flatMap((c) => c.classes.map((cg) => ({ ...cg, courseName: c.name })));
  return rows.filter((c) => c.status === undefined || c.status === 'open');
}

function BookTrialButton({ lead }: { lead: LearnerLead }) {
  const [open, setOpen] = useState(false);
  return open ? <BookTrialDialog lead={lead} onClose={() => setOpen(false)} /> : <button className="btn" onClick={() => setOpen(true)}>Đặt học thử</button>;
}

function BookTrialDialog({ lead, onClose }: { lead: LearnerLead; onClose: () => void }) {
  const toast = useToast();
  const courses = useApi<CoursePick>('/courses');
  const classes = pickClasses(courses.data);
  const sessions = classes.flatMap((c) => c.trialSessions.map((s) => ({ ...s, label: `${c.courseName} · ${c.name}` })));
  const [sessionId, setSessionId] = useState('');
  const m = useCommand<BookTrialInput>('bookTrial');
  return (
    <Modal open title="Đặt học thử" onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Hủy</button>
        <button className="btn btn-primary" disabled={m.isPending || !sessionId}
          onClick={() => m.mutate({ leadId: lead.id, expectedVersion: lead.version, sessionId }, { onSuccess: () => { toast('Đã đặt học thử'); onClose(); } })}>Đặt</button>
      </>
    }>
      <div className="stack">
        <Field label="Buổi học thử" htmlFor="trial-session" required>
          <select id="trial-session" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
            <option value="">{sessions.length ? 'Chọn buổi' : 'Chưa có buổi học thử đang mở'}</option>
            {sessions.map((s) => <option key={s.id} value={s.id}>{s.label} · {fmtDateTime(s.startsAt)}</option>)}
          </select>
        </Field>
        <FormError error={m.error ?? courses.error} />
      </div>
    </Modal>
  );
}

function ReserveButton({ lead }: { lead: LearnerLead }) {
  const [open, setOpen] = useState(false);
  return open ? <ReserveDialog lead={lead} onClose={() => setOpen(false)} /> : <button className="btn" onClick={() => setOpen(true)}>Giữ chỗ</button>;
}

function ReserveDialog({ lead, onClose }: { lead: LearnerLead; onClose: () => void }) {
  const toast = useToast();
  const courses = useApi<CoursePick>('/courses');
  const classes = pickClasses(courses.data);
  const [classId, setClassId] = useState('');
  const m = useCommand<ReserveSeatInput>('reserveSeat');
  return (
    <Modal open title="Giữ chỗ" onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Hủy</button>
        <button className="btn btn-primary" disabled={m.isPending || !classId}
          onClick={() => m.mutate({ leadId: lead.id, expectedVersion: lead.version, classId }, { onSuccess: () => { toast('Đã giữ chỗ'); onClose(); } })}>Giữ chỗ</button>
      </>
    }>
      <div className="stack">
        <p className="text-2">Tạo ghi danh chờ. Người trả là học viên. Tổ chức sẽ xác nhận chỗ.</p>
        <Field label="Lớp đang mở" htmlFor="reserve-class" required>
          <select id="reserve-class" value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">{classes.length ? 'Chọn lớp' : 'Chưa có lớp đang mở'}</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.courseName} · {c.name}{c.scheduleText ? ` · ${c.scheduleText}` : ''}</option>)}
          </select>
        </Field>
        <FormError error={m.error ?? courses.error} />
      </div>
    </Modal>
  );
}

function EnrollmentsCard({ detail, canWork }: { detail: Detail; canWork: boolean }) {
  const toast = useToast();
  const cancel = useCommand<CancelPendingEnrollmentInput>('cancelPendingEnrollment');
  const rows = detail.enrollments;
  return (
    <section className="card" aria-labelledby="ln-enr">
      <div className="card-head"><h2 id="ln-enr">Ghi danh</h2></div>
      {rows.length === 0 ? <Empty title="Chưa có ghi danh" /> : (
        <ul className="list">
          {rows.map((e) => (
            <li key={e.id} className="row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="truncate">{e.courseName} · {e.className}</div>
                <div className="small muted"><span className="mono">{e.leadCode}</span> · {enrollmentStatusLabel(e.status)}</div>
              </div>
              {canWork && e.status === 'pending' && (
                <button className="btn btn-sm" disabled={cancel.isPending} onClick={() => cancel.mutate({ enrollmentId: e.id, version: e.version }, { onSuccess: () => toast('Đã hủy chỗ chờ') })}>Hủy chờ</button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="card-body"><FormError error={cancel.error} /></div>
    </section>
  );
}

function SkipTrialDialog({ lead, onClose }: { lead: LearnerLead; onClose: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const m = useCommand<SkipTrialInput>('skipTrial');
  const errors = fieldErrors(m.error);
  return (
    <Modal open title="Bỏ qua học thử" onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Hủy</button>
        <button className="btn btn-primary" disabled={m.isPending || !reason.trim()}
          onClick={() => m.mutate({ leadId: lead.id, expectedVersion: lead.version, reason }, { onSuccess: () => { toast('Đã bỏ qua học thử'); onClose(); } })}>Xác nhận</button>
      </>
    }>
      <div className="stack">
        <Field label="Lý do bỏ qua" required error={errors.reason} htmlFor="skip-reason">
          <textarea id="skip-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </Field>
        <FormError error={m.error && !errors.reason ? m.error : null} />
      </div>
    </Modal>
  );
}

function WinDialog({ lead, onClose }: { lead: LearnerLead; onClose: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const m = useCommand<WinLearnerLeadInput>('winLearnerLead');
  return (
    <Modal open title="Chốt thắng" onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Hủy</button>
        <button className="btn btn-primary" disabled={m.isPending}
          onClick={() => m.mutate({ leadId: lead.id, expectedVersion: lead.version, note: note.trim() || undefined }, { onSuccess: () => { toast('Đã chốt thắng'); onClose(); } })}>Chốt thắng</button>
      </>
    }>
      <div className="stack">
        <p className="text-2">Cần xong bước Xác nhận nhu cầu và Học thử (hoặc đã bỏ qua kèm lý do). Sau khi thắng, khách được giữ lâu dài.</p>
        <Field label="Ghi chú" htmlFor="win-note"><textarea id="win-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></Field>
        <FormError error={m.error} />
      </div>
    </Modal>
  );
}

function CloseDialog({ lead, onClose }: { lead: LearnerLead; onClose: () => void }) {
  const toast = useToast();
  const [outcome, setOutcome] = useState<CloseLearnerLeadInput['outcome']>('lost');
  const [reason, setReason] = useState<LearnerLostReasonCode>('price');
  const [note, setNote] = useState('');
  const m = useCommand<CloseLearnerLeadInput>('closeLearnerLead');
  const errors = fieldErrors(m.error);
  return (
    <Modal open title="Đóng lead" onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Hủy</button>
        <button className="btn btn-danger" disabled={m.isPending}
          onClick={() => m.mutate({ leadId: lead.id, expectedVersion: lead.version, outcome, reason, note: note.trim() || undefined }, { onSuccess: () => { toast('Đã đóng lead'); onClose(); } })}>Đóng lead</button>
      </>
    }>
      <div className="stack">
        <Field label="Kết quả" htmlFor="close-outcome">
          <select id="close-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
            <option value="lost">Mất</option>
            <option value="not_fit">Không phù hợp</option>
          </select>
        </Field>
        <Field label="Lý do" htmlFor="close-reason">
          <select id="close-reason" value={reason} onChange={(e) => setReason(e.target.value as LearnerLostReasonCode)}>
            {LEARNER_LOST_REASONS.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
          </select>
        </Field>
        <Field label="Ghi chú" required={reason === 'other'} error={errors.note} htmlFor="close-note">
          <textarea id="close-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </Field>
        <FormError error={m.error && !errors.note ? m.error : null} />
      </div>
    </Modal>
  );
}

// ---------- products, consent, owner ----------

function ProductsCard({ detail, canWork }: { detail: Detail; canWork: boolean }) {
  const toast = useToast();
  const catalogue = useApi<ProductItem[]>(canWork ? '/products' : null);
  const attach = useCommand<{ contactId: string; productId: string }>('attachProduct');
  const detach = useCommand<{ customerProductId: string; version: number }>('detachProduct');
  const [pick, setPick] = useState('');
  const attached = new Set(detail.products.map((p) => p.productId));
  const options = (catalogue.data ?? []).filter((p) => p.active && !attached.has(p.id));
  const row = (p: LearnerProduct) => (
    <li key={p.id} className="row">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="truncate">{p.name}</div>
        <div className="small muted">{fmtMoney(p.priceVnd, false)} · gắn {fmtDate(p.attachedAt)}{p.detachedAt ? ` · gỡ ${fmtDate(p.detachedAt)}` : ''}</div>
      </div>
      {canWork && !p.detachedAt && (
        <button className="btn btn-sm" disabled={detach.isPending}
          onClick={() => detach.mutate({ customerProductId: p.id, version: p.version }, { onSuccess: () => toast('Đã gỡ sản phẩm') })}>Gỡ</button>
      )}
    </li>
  );
  return (
    <section className="card" aria-labelledby="ln-prod">
      <div className="card-head"><h2 id="ln-prod">Sản phẩm</h2></div>
      {detail.products.length === 0 ? <Empty title="Chưa gắn sản phẩm" /> : <ul className="list">{detail.products.map(row)}</ul>}
      {canWork && (
        <div className="card-body stack-sm" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="row">
            <label className="visually-hidden" htmlFor="ln-pick">Chọn sản phẩm</label>
            <select id="ln-pick" value={pick} onChange={(e) => setPick(e.target.value)} style={{ flex: 1 }}>
              <option value="">Chọn sản phẩm để gắn</option>
              {options.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button className="btn btn-primary" disabled={!pick || attach.isPending}
              onClick={() => attach.mutate({ contactId: detail.contact.id, productId: pick }, { onSuccess: () => { setPick(''); toast('Đã gắn sản phẩm'); } })}>Gắn</button>
          </div>
          <FormError error={attach.error ?? detach.error} />
        </div>
      )}
      {detail.detachedProducts.length > 0 && (
        <details className="card-body" style={{ borderTop: '1px solid var(--border)' }}>
          <summary className="small muted">Đã gỡ ({detail.detachedProducts.length})</summary>
          <ul className="list">{detail.detachedProducts.map(row)}</ul>
        </details>
      )}
    </section>
  );
}

function ConsentCard({ detail, canWork }: { detail: Detail; canWork: boolean }) {
  const toast = useToast();
  const m = useCommand<RecordConsentInput>('recordConsent');
  return (
    <section className="card" aria-labelledby="ln-consent">
      <div className="card-head"><h2 id="ln-consent">Đồng ý của khách</h2></div>
      <ul className="list">
        {detail.consents.map((c) => (
          <li key={c.purpose} className="row">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div>{c.label}</div>
              <div className="small muted">{c.recordedAt ? `Cập nhật ${fmtDateTime(c.recordedAt)}` : 'Chưa ghi nhận'}</div>
            </div>
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" role="switch" checked={c.granted} disabled={!canWork || m.isPending}
                onChange={(e) => m.mutate({ contactId: detail.contact.id, purpose: c.purpose as RecordConsentInput['purpose'], granted: e.target.checked }, { onSuccess: () => toast('Đã ghi đồng ý') })} />
              <span className="small">{c.granted ? 'Đồng ý' : 'Không'}</span>
            </label>
          </li>
        ))}
      </ul>
      {m.error && <div className="card-body"><FormError error={m.error} /></div>}
      {!canWork && <div className="card-body small muted">Chỉ người giữ khách, Leader nhóm hoặc Admin ghi đồng ý.</div>}
    </section>
  );
}

function ChangeOwnerDialog({ contact, members, permissions, onClose }: {
  contact: LearnerContact; members: { id: string; name: string; role: string }[]; permissions: LearnerPermissions; onClose: () => void;
}) {
  const toast = useToast();
  const [ownerUserId, setOwner] = useState('');
  const m = useCommand<ChangeCustomerOwnerInput>('changeCustomerOwner');
  return (
    <Modal open title="Đổi sale giữ khách" onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Hủy</button>
        <button className="btn btn-primary" disabled={m.isPending || !ownerUserId || !permissions.changeOwner}
          onClick={() => m.mutate({ contactId: contact.id, version: contact.version, ownerUserId }, { onSuccess: () => { toast('Đã đổi sale'); onClose(); } })}>Đổi sale</button>
      </>
    }>
      <div className="stack">
        <p className="text-2">Hạn giữ 3 tháng được tính lại từ hôm nay. Lead và việc đang mở chuyển theo sale mới.</p>
        <Field label="Sale mới" htmlFor="owner-pick">
          <select id="owner-pick" value={ownerUserId} onChange={(e) => setOwner(e.target.value)}>
            <option value="">Chọn sale</option>
            {members.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </Field>
        <FormError error={m.error} />
      </div>
    </Modal>
  );
}
