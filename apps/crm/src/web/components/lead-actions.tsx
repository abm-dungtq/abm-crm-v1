import { useEffect, useId, useState } from 'react';
import {
  ACTIVITY_TYPES, LOST_REASONS, allowedTransitions, stageLabel,
  type ChangeStageInput, type CompleteTaskInput, type DecideApprovalInput, type LogActivityInput, type LostReasonCode, type StageCode,
} from '@abm/contracts';
import { useCommand } from '../api';
import { fmtMoney, fromLocalInput, toLocalInput } from '../format';
import type { ApprovalItem, Member } from '../types';
import { Alert, Field, FormError, Modal, fieldErrors, useToast } from './ui';

// ---------- Next Action fields (QĐ13) ----------

export interface NextActionDraft { title: string; due: string }

const at = (days: number, hour: number, minute = 0) => {
  const d = new Date(Date.now() + 7 * 3600_000);
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, minute, 0, 0);
  return toLocalInput(new Date(d.getTime() - 7 * 3600_000));
};
const QUICK_DUE = [
  { label: 'Hôm nay 17:00', value: () => at(0, 17) },
  { label: 'Sáng mai 9:00', value: () => at(1, 9) },
  { label: '+3 ngày', value: () => at(3, 9) },
  { label: '+1 tuần', value: () => at(7, 9) },
];

export const emptyNextAction = (title = ''): NextActionDraft => ({ title, due: at(1, 9) });
export const nextActionPayload = (draft: NextActionDraft) => ({ title: draft.title.trim(), dueAt: fromLocalInput(draft.due) });

export function NextActionFields({ value, onChange, errors, legend = 'Next Action tiếp theo' }: {
  value: NextActionDraft; onChange: (v: NextActionDraft) => void; errors?: Record<string, string>; legend?: string;
}) {
  const id = useId();
  return (
    <fieldset className="stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="field-label" style={{ marginBottom: 6 }}>{legend} <span className="req" style={{ color: 'var(--danger)' }}>*</span></legend>
      <Field label="Việc cần làm" htmlFor={`${id}-t`} error={errors?.['nextAction.title']}>
        <input id={`${id}-t`} type="text" value={value.title} placeholder="VD: Gọi lại xác nhận lịch demo" required
          aria-invalid={Boolean(errors?.['nextAction.title'])} onChange={(e) => onChange({ ...value, title: e.target.value })} />
      </Field>
      <Field label="Hạn (giờ Việt Nam)" htmlFor={`${id}-d`} error={errors?.['nextAction.dueAt']}>
        <input id={`${id}-d`} type="datetime-local" value={value.due} required onChange={(e) => onChange({ ...value, due: e.target.value })} />
      </Field>
      <div className="chips" aria-label="Chọn nhanh hạn">
        {QUICK_DUE.map((q) => {
          const v = q.value();
          return <button type="button" key={q.label} className="chip" aria-pressed={value.due === v} onClick={() => onChange({ ...value, due: v })}>{q.label}</button>;
        })}
      </div>
    </fieldset>
  );
}

// ---------- Log activity ----------

const MANUAL = ACTIVITY_TYPES.filter((a) => a.manual);

export function LogActivityForm({ leadId, version, firstContactMissing }: { leadId: string; version: number; firstContactMissing: boolean }) {
  const [type, setType] = useState<LogActivityInput['type']>('call');
  const [summary, setSummary] = useState('');
  const mutation = useCommand<LogActivityInput, { firstContact: boolean }>('logActivity');
  const toast = useToast();
  const errors = fieldErrors(mutation.error);
  const id = useId();
  return (
    <form className="stack-sm" onSubmit={(e) => {
      e.preventDefault();
      mutation.mutate({ leadId, expectedVersion: version, type, summary }, {
        onSuccess: (r) => { setSummary(''); toast(r.firstContact ? 'Đã ghi nhận liên hệ lần đầu' : 'Đã ghi hoạt động'); },
      });
    }}>
      <div className="chips" role="group" aria-label="Loại hoạt động">
        {MANUAL.map((a) => (
          <button type="button" key={a.code} className="chip" aria-pressed={type === a.code} onClick={() => setType(a.code as LogActivityInput['type'])}>{a.label}</button>
        ))}
      </div>
      <label className="visually-hidden" htmlFor={`${id}-s`}>Nội dung hoạt động</label>
      <textarea id={`${id}-s`} value={summary} onChange={(e) => setSummary(e.target.value)} required aria-invalid={Boolean(errors.summary)}
        placeholder={type === 'call' ? 'Kết quả cuộc gọi: khách nói gì, hẹn gì…' : 'Nội dung chính…'} />
      {firstContactMissing && ACTIVITY_TYPES.find((a) => a.code === type)?.contact && (
        <span className="field-hint">Hoạt động này sẽ được tính là liên hệ lần đầu.</span>
      )}
      <FormError error={mutation.error && !errors.summary ? mutation.error : null} />
      <div className="row"><span className="spacer" /><button className="btn btn-primary" disabled={mutation.isPending || !summary.trim()}>{mutation.isPending ? 'Đang lưu…' : 'Ghi hoạt động'}</button></div>
    </form>
  );
}

// ---------- Change stage ----------

export function ChangeStageDialog({ open, onClose, lead, initial }: {
  open: boolean; onClose: () => void; lead: { id: string; code: string; stage: StageCode; version: number; firstContactAt: string | null }; initial?: StageCode;
}) {
  const options = allowedTransitions(lead.stage);
  const [to, setTo] = useState<StageCode>(initial ?? options[0] ?? 'lost');
  const [reason, setReason] = useState<LostReasonCode | ''>('');
  const [note, setNote] = useState('');
  const [wonValue, setWonValue] = useState('');
  const [wonNote, setWonNote] = useState('');
  const mutation = useCommand<ChangeStageInput>('changeStage');
  const toast = useToast();
  const errors = fieldErrors(mutation.error);
  useEffect(() => { if (open) { setTo(initial ?? options[0] ?? 'lost'); setReason(''); setNote(''); setWonValue(''); setWonNote(''); mutation.reset(); } }, [open]);
  // Dots and spaces are thousands separators; a comma means a decimal, which đồng never has.
  const wonAmount = wonValue.includes(',') ? 0 : Number(wonValue.replace(/[.\s]/g, ''));
  const wonIncomplete = to === 'won' && (!wonAmount || !wonNote.trim());
  const needsContact = lead.stage === 'new' && to === 'contacted' && !lead.firstContactAt;
  const submit = () => mutation.mutate(
    {
      leadId: lead.id, expectedVersion: lead.version, toStage: to, lostReason: reason || undefined, lostNote: note || undefined,
      wonValue: to === 'won' ? wonAmount : undefined, wonNote: to === 'won' ? wonNote : undefined,
    },
    { onSuccess: () => { toast(`${lead.code}: ${stageLabel(lead.stage)} → ${stageLabel(to)}`); onClose(); } },
  );
  return (
    <Modal open={open} onClose={onClose} title={`Đổi stage ${lead.code}`} footer={<>
      <button className="btn" onClick={onClose}>Hủy</button>
      <button className={`btn ${to === 'lost' ? 'btn-danger' : 'btn-primary'}`} disabled={mutation.isPending || needsContact || wonIncomplete} onClick={submit}>
        {mutation.isPending ? 'Đang lưu…' : to === 'lost' ? 'Đóng Lost' : to === 'won' ? 'Xác nhận Won' : `Chuyển sang ${stageLabel(to)}`}
      </button>
    </>}>
      <p className="text-2">Hiện tại: <strong>{stageLabel(lead.stage)}</strong>. MVP1 chỉ tiến một bước; Won chỉ từ Chờ chốt; Won/Lost không mở lại.</p>
      <div className="chips" role="radiogroup" aria-label="Stage đích">
        {options.map((s) => <button type="button" role="radio" aria-checked={to === s} aria-pressed={to === s} key={s} className="chip" onClick={() => setTo(s)}>{stageLabel(s)}</button>)}
      </div>
      {needsContact && <Alert tone="warn">Chưa có liên hệ lần đầu. Ghi một cuộc gọi, tin nhắn, email hoặc buổi gặp trước khi chuyển sang Đã liên hệ.</Alert>}
      {to === 'lost' && (
        <>
          <Field label="Lý do Lost" required error={errors.lostReason} htmlFor="lost-reason">
            <select id="lost-reason" value={reason} onChange={(e) => setReason(e.target.value as LostReasonCode)} aria-invalid={Boolean(errors.lostReason)}>
              <option value="">Chọn lý do…</option>
              {LOST_REASONS.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
          </Field>
          <Field label="Ghi chú" required={reason === 'other'} error={errors.lostNote} htmlFor="lost-note" hint="Bắt buộc khi chọn “Khác”.">
            <textarea id="lost-note" value={note} onChange={(e) => setNote(e.target.value)} aria-invalid={Boolean(errors.lostNote)} />
          </Field>
        </>
      )}
      {to === 'won' && (
        <>
          <Field label="Giá trị chốt (đồng)" required error={errors.wonValue} htmlFor="won-value" hint={wonAmount ? fmtMoney(wonAmount, false) : 'Số nguyên đồng, lớn hơn 0.'}>
            <input id="won-value" type="text" inputMode="numeric" value={wonValue} placeholder="VD: 350000000" aria-invalid={Boolean(errors.wonValue)}
              onChange={(e) => setWonValue(e.target.value.replace(/[^\d.,\s]/g, ''))} />
          </Field>
          <Field label="Bằng chứng chốt" required error={errors.wonNote} htmlFor="won-note" hint="VD: số hợp đồng, PO, email xác nhận.">
            <textarea id="won-note" value={wonNote} onChange={(e) => setWonNote(e.target.value)} aria-invalid={Boolean(errors.wonNote)} />
          </Field>
          <Alert tone="info">Won sẽ đóng lead, hủy các việc còn mở. Bàn giao triển khai thuộc MVP2.</Alert>
        </>
      )}
      <FormError error={mutation.error && !errors.lostReason && !errors.lostNote && !errors.wonValue && !errors.wonNote ? mutation.error : null} />
    </Modal>
  );
}

// ---------- Complete task with forced next action ----------

export function CompleteTaskDialog({ open, onClose, task, requiresNext, leadCode }: {
  open: boolean; onClose: () => void; task: { id: string; title: string; version: number }; requiresNext: boolean; leadCode: string;
}) {
  const [outcome, setOutcome] = useState('');
  const [next, setNext] = useState(emptyNextAction());
  const [addNext, setAddNext] = useState(requiresNext);
  const mutation = useCommand<CompleteTaskInput>('completeTask');
  const toast = useToast();
  const errors = fieldErrors(mutation.error);
  useEffect(() => { if (open) { setOutcome(''); setNext(emptyNextAction()); setAddNext(requiresNext); mutation.reset(); } }, [open]);
  const submit = () => mutation.mutate(
    { taskId: task.id, expectedVersion: task.version, outcome: outcome || undefined, nextAction: addNext ? nextActionPayload(next) : undefined },
    { onSuccess: () => { toast(`Đã hoàn thành: ${task.title}`); onClose(); } },
  );
  return (
    <Modal open={open} onClose={onClose} title="Hoàn thành việc" footer={<>
      <button className="btn" onClick={onClose}>Hủy</button>
      <button className="btn btn-primary" disabled={mutation.isPending || (addNext && !next.title.trim())} onClick={submit}>{mutation.isPending ? 'Đang lưu…' : 'Hoàn thành'}</button>
    </>}>
      <div><div className="muted small">{leadCode}</div><strong>{task.title}</strong></div>
      <Field label="Kết quả" htmlFor="task-outcome">
        <textarea id="task-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="Đã làm gì, khách phản hồi ra sao…" />
      </Field>
      {requiresNext
        ? <Alert tone="info">Đây là Next Action của lead đang mở. Lead luôn phải có Owner + Next Action + Deadline (QĐ13), nên cần đặt việc tiếp theo.</Alert>
        : <label className="row"><input type="checkbox" checked={addNext} onChange={(e) => setAddNext(e.target.checked)} /> Tạo việc tiếp theo</label>}
      {addNext && <NextActionFields value={next} onChange={setNext} errors={errors} />}
      <FormError error={mutation.error && !errors['nextAction.title'] ? mutation.error : null} />
    </Modal>
  );
}

// ---------- Assign / reassign (Leader) ----------

export function AssignDialog({ open, onClose, lead, members }: {
  open: boolean; onClose: () => void; lead: { id: string; code: string; version: number; status: string; ownerId: string | null }; members: Member[];
}) {
  const [owner, setOwner] = useState('');
  const [custom, setCustom] = useState(false);
  const [next, setNext] = useState(emptyNextAction('Liên hệ lần đầu'));
  const mutation = useCommand<unknown>('assignLead');
  const toast = useToast();
  const errors = fieldErrors(mutation.error);
  useEffect(() => { if (open) { setOwner(''); setCustom(false); setNext(emptyNextAction('Liên hệ lần đầu')); mutation.reset(); } }, [open]);
  const isQueue = lead.status === 'queue';
  const submit = () => mutation.mutate(
    { leadId: lead.id, expectedVersion: lead.version, ownerUserId: owner, nextAction: isQueue && custom ? nextActionPayload(next) : undefined },
    { onSuccess: () => { toast(`${lead.code} đã giao cho ${members.find((m) => m.id === owner)?.name ?? ''}`); onClose(); } },
  );
  return (
    <Modal open={open} onClose={onClose} title={isQueue ? `Giao ${lead.code}` : `Phân lại ${lead.code}`} footer={<>
      <button className="btn" onClick={onClose}>Hủy</button>
      <button className="btn btn-primary" disabled={!owner || mutation.isPending} onClick={submit}>{mutation.isPending ? 'Đang giao…' : 'Giao'}</button>
    </>}>
      <Field label="Người phụ trách" required error={errors.ownerUserId} htmlFor="assign-owner">
        <select id="assign-owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">Chọn thành viên team…</option>
          {members.filter((m) => m.id !== lead.ownerId).map((m) => <option key={m.id} value={m.id}>{m.name}{m.role === 'leader' ? ' (Leader)' : ''}</option>)}
        </select>
      </Field>
      {isQueue && (
        <>
          <p className="text-2 small">Mặc định tạo Next Action “Liên hệ lần đầu”, hạn 4 giờ làm việc (QĐ4).</p>
          <label className="row"><input type="checkbox" checked={custom} onChange={(e) => setCustom(e.target.checked)} /> Đặt Next Action khác</label>
          {custom && <NextActionFields value={next} onChange={setNext} errors={errors} legend="Next Action đầu tiên" />}
        </>
      )}
      {!isQueue && <p className="text-2 small">Next Action đang mở sẽ chuyển sang owner mới.</p>}
      <FormError error={mutation.error && !errors.ownerUserId ? mutation.error : null} />
    </Modal>
  );
}

export function ReleaseDialog({ open, onClose, lead }: { open: boolean; onClose: () => void; lead: { id: string; code: string; version: number } }) {
  const [reason, setReason] = useState('');
  const mutation = useCommand<unknown>('releaseLead');
  const toast = useToast();
  useEffect(() => { if (open) { setReason(''); mutation.reset(); } }, [open]);
  return (
    <Modal open={open} onClose={onClose} title={`Nhả ${lead.code} về hàng chờ`} footer={<>
      <button className="btn" onClick={onClose}>Hủy</button>
      <button className="btn btn-danger" disabled={!reason.trim() || mutation.isPending}
        onClick={() => mutation.mutate({ leadId: lead.id, expectedVersion: lead.version, reason }, { onSuccess: () => { toast(`${lead.code} đã về hàng chờ`); onClose(); } })}>
        Nhả lead
      </button>
    </>}>
      <p className="text-2">Lead đã quá 24 giờ làm việc chưa được liên hệ lần đầu. Owner hiện tại sẽ mất quyền, việc đang mở bị hủy.</p>
      <Field label="Lý do" required htmlFor="release-reason"><textarea id="release-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <FormError error={mutation.error} />
    </Modal>
  );
}

export function RequestOwnerDialog({ open, onClose, lead, members }: {
  open: boolean; onClose: () => void; lead: { id: string; code: string; version: number; ownerId: string | null }; members: Member[];
}) {
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const mutation = useCommand<unknown>('requestOwnerChange');
  const toast = useToast();
  useEffect(() => { if (open) { setTo(''); setReason(''); mutation.reset(); } }, [open]);
  return (
    <Modal open={open} onClose={onClose} title={`Yêu cầu chuyển owner ${lead.code}`} footer={<>
      <button className="btn" onClick={onClose}>Hủy</button>
      <button className="btn btn-primary" disabled={!to || !reason.trim() || mutation.isPending}
        onClick={() => mutation.mutate({ leadId: lead.id, expectedVersion: lead.version, toUserId: to, reason }, { onSuccess: () => { toast('Đã gửi yêu cầu cho Leader duyệt'); onClose(); } })}>
        Gửi yêu cầu
      </button>
    </>}>
      <p className="text-2">Leader của team duyệt yêu cầu (QĐ14). Nếu lead thay đổi trước khi duyệt, yêu cầu sẽ hết hiệu lực.</p>
      <Field label="Chuyển cho" required htmlFor="req-to">
        <select id="req-to" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">Chọn đồng nghiệp…</option>
          {members.filter((m) => m.id !== lead.ownerId).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </Field>
      <Field label="Lý do" required htmlFor="req-reason"><textarea id="req-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <FormError error={mutation.error} />
    </Modal>
  );
}

// ---------- Approval decision ----------

export function approvalTitle(a: ApprovalItem) {
  if (a.kind === 'owner_change') return `Chuyển owner: ${a.payload.fromUserName ?? '—'} → ${a.payload.toUserName ?? '—'}`;
  return `Đổi stage: ${stageLabel(a.lead.stage)} → ${stageLabel(a.payload.toStage ?? '')}`;
}

export function DecideButtons({ approval }: { approval: ApprovalItem }) {
  const [mode, setMode] = useState<'approve' | 'reject' | null>(null);
  const [note, setNote] = useState('');
  const mutation = useCommand<DecideApprovalInput, { status: string }>('decideApproval');
  const toast = useToast();
  const close = () => { setMode(null); setNote(''); mutation.reset(); };
  const submit = () => mutation.mutate(
    { approvalId: approval.id, expectedVersion: approval.version, decision: mode ?? 'reject', note: note || undefined },
    {
      onSuccess: (r) => {
        toast(r.status === 'approved' ? 'Đã duyệt và thực hiện' : r.status === 'stale' ? 'Lead đã đổi sau khi tạo yêu cầu: yêu cầu hết hiệu lực, không thực hiện' : 'Đã từ chối', r.status === 'stale' ? 'danger' : undefined);
        close();
      },
    },
  );
  return (
    <>
      <div className="row-wrap">
        <button className="btn btn-primary btn-sm" onClick={() => setMode('approve')}>Duyệt</button>
        <button className="btn btn-sm" onClick={() => setMode('reject')}>Từ chối</button>
      </div>
      <Modal open={mode !== null} onClose={close} title={mode === 'approve' ? 'Duyệt yêu cầu' : 'Từ chối yêu cầu'} footer={<>
        <button className="btn" onClick={close}>Hủy</button>
        <button className={`btn ${mode === 'approve' ? 'btn-primary' : 'btn-danger'}`} disabled={mutation.isPending} onClick={submit}>{mode === 'approve' ? 'Duyệt và thực hiện' : 'Từ chối'}</button>
      </>}>
        <div><div className="muted small">{approval.lead.code} · {approval.lead.contactName}</div><strong>{approvalTitle(approval)}</strong></div>
        {approval.isStale && <Alert tone="warn">Lead đã thay đổi sau khi yêu cầu được tạo. Duyệt bây giờ sẽ không thực hiện mà đánh dấu yêu cầu hết hiệu lực.</Alert>}
        <Field label="Ghi chú" htmlFor="decide-note"><textarea id="decide-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <FormError error={mutation.error} />
      </Modal>
    </>
  );
}
