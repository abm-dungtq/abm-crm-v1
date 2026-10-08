import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { COMMANDS } from '@abm/contracts';
import { useActor } from '../actor-context';
import { ApiFailure, classifyIntake, confirmIntakeField, discardIntake, linkIntakeContact, listIntakes, requestExtraction, useApi } from '../api';
import { DuplicateMatches, duplicateMatches } from '../pages/lead-new';
import { useOwnerOptions } from '../pages/learners';
import {
  INTAKE_FIELDS, type ClassifyIntakeResult, type InboxConversation, type IntakeField, type IntakePipeline, type LeadIntake, type LearnerList,
} from '../types';
import { NextActionFields, emptyNextAction, nextActionPayload } from './lead-actions';
import { Alert, ErrorState, Field, FormError, Loading, Modal, fieldErrors, useDebounced, useToast } from './ui';

/** Extraction results arrive from the bridge a little later, so the open conversation's intake is polled. */
const INTAKE_POLL_MS = 10_000;
/** Same limit as needSummary in createLeadInput / createLearnerLeadInput. */
const NEED_MAX = 1000;

export const INTAKE_FIELD_LABEL: Record<IntakeField, string> = {
  name: 'Tên', phone: 'SĐT', email: 'Email', need: 'Nhu cầu', interest: 'Quan tâm', note: 'Ghi chú',
};
const PIPELINE_LABEL: Record<IntakePipeline, string> = { b2b: 'Tạo lead B2B', learner: 'Tạo lead học viên' };
/** Roles that list customers in their scope (GET /learners), the same scope link-contact checks. */
const LINK_ROLES: readonly string[] = ['sale', 'leader', 'director', 'admin'];

const intakesKey = (conversationId: string) => ['inbox', 'intakes', { status: 'pending', conversationId }] as const;

/** Every intake action refreshes the inbox queries, including after a failure (the intake may have moved on). */
function useInboxRefresh() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ['inbox'] });
}

/** Right-column card of a direct conversation: the pending intake, if any, and "Cập nhật CRM". */
export function IntakeCard({ conversation }: { conversation: InboxConversation }) {
  const toast = useToast();
  const refresh = useInboxRefresh();
  const intakes = useQuery<LeadIntake[], ApiFailure>({
    queryKey: intakesKey(conversation.id),
    queryFn: () => listIntakes({ status: 'pending', conversationId: conversation.id }),
    refetchInterval: INTAKE_POLL_MS,
    refetchIntervalInBackground: false,
  });
  const extract = useMutation<{ commandId: string }, ApiFailure>({
    mutationFn: () => requestExtraction(conversation.id),
    onSuccess: () => toast('Đã gửi yêu cầu cập nhật CRM. Kết quả hiện ở đây sau ít phút.'),
    onSettled: refresh,
  });
  const intake = intakes.data?.[0];
  return (
    <section className="stack-sm intake-card" aria-label="Lead chờ phân loại">
      <div className="row">
        <div className="field-label">Lead chờ phân loại</div>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={() => extract.mutate()} disabled={extract.isPending}
          title="Nhờ bot đọc lại hội thoại và cập nhật thông tin khách">
          {extract.isPending ? 'Đang gửi…' : 'Cập nhật CRM'}
        </button>
      </div>
      <FormError error={extract.error} />
      {intakes.isLoading && <Loading rows={1} />}
      {intakes.error && <ErrorState error={intakes.error} onRetry={() => intakes.refetch()} />}
      {intakes.data && !intake && (
        <p className="small muted">Chưa có. Bot trích thông tin khách khi chuyển người, khi trả lại AI hoặc khi khách im 15 phút.</p>
      )}
      {intake && <IntakeDetails key={intake.id} intake={intake} fallbackName={conversation.displayName} />}
    </section>
  );
}

function IntakeDetails({ intake, fallbackName }: { intake: LeadIntake; fallbackName: string | null }) {
  const actor = useActor();
  const toast = useToast();
  const refresh = useInboxRefresh();
  const [pipeline, setPipeline] = useState<IntakePipeline | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const confirm = useMutation<unknown, ApiFailure, IntakeField>({
    mutationFn: (field) => confirmIntakeField(intake.id, field),
    onSuccess: (_data, field) => toast(`Đã dùng giá trị mới cho ${INTAKE_FIELD_LABEL[field]}`),
    onSettled: refresh,
  });
  const shown = INTAKE_FIELDS.filter((f) => intake.fields[f] || intake.proposed[f]);
  const canCreate = (p: IntakePipeline) =>
    (COMMANDS[p === 'b2b' ? 'createLead' : 'createLearnerLead'].roles as readonly string[]).includes(actor.role);

  return (
    <div className="stack-sm">
      {shown.length ? (
        <dl className="intake-fields">
          {shown.map((f) => (
            <div key={f}>
              <dt>{INTAKE_FIELD_LABEL[f]}</dt>
              <dd>
                {intake.fields[f] ?? <span className="muted">Chưa có</span>}
                {intake.proposed[f] && (
                  <div className="intake-proposed">
                    <span className="small"><strong>Giá trị mới:</strong> {intake.proposed[f]}</span>
                    <button className="btn btn-sm" disabled={confirm.isPending} onClick={() => confirm.mutate(f)}
                      aria-label={`Dùng giá trị mới cho ${INTAKE_FIELD_LABEL[f]}`}>
                      Dùng giá trị mới
                    </button>
                  </div>
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : <p className="small muted">Bot chưa trích được thông tin nào.</p>}
      <FormError error={confirm.error} />
      <div className="stack-sm">
        {(['b2b', 'learner'] as const).filter(canCreate).map((p) => (
          <button key={p} className={p === 'b2b' ? 'btn btn-primary' : 'btn'} onClick={() => setPipeline(p)}>{PIPELINE_LABEL[p]}</button>
        ))}
        <button className="btn btn-ghost" onClick={() => setDiscarding(true)}>Bỏ qua</button>
      </div>
      {pipeline && <ClassifyDialog intake={intake} pipeline={pipeline} fallbackName={fallbackName} onClose={() => setPipeline(null)} />}
      {discarding && <DiscardDialog intakeId={intake.id} onClose={() => setDiscarding(false)} />}
    </div>
  );
}

interface ClassifyForm {
  contactName: string; phone: string; email: string; companyName: string; taxCode: string; needSummary: string; sourceNote: string; ownerUserId: string;
}

/** Form values from the intake: name, phone and email as they are; need, interest and note together as the need summary. */
function prefill(intake: LeadIntake, fallbackName: string | null): ClassifyForm {
  const f = intake.fields;
  const need = [f.need, f.interest && `Quan tâm: ${f.interest}`, f.note && `Ghi chú: ${f.note}`].filter(Boolean).join('\n');
  return {
    contactName: f.name ?? fallbackName?.trim() ?? '', phone: f.phone ?? '', email: f.email ?? '', companyName: '', taxCode: '',
    needSummary: need.slice(0, NEED_MAX), sourceNote: '', ownerUserId: '',
  };
}

const opt = (v: string) => v.trim() || undefined;

/**
 * Pre-filled lead form. The server runs createLead / createLearnerLead with `source` set from the channel. A
 * DUPLICATE_SUSPECTED answer offers "Vẫn tạo lead mới" (resent with confirmNotDuplicate only on that click) or
 * "Gắn vào khách có sẵn".
 */
function ClassifyDialog({ intake, pipeline, fallbackName, onClose }: {
  intake: LeadIntake; pipeline: IntakePipeline; fallbackName: string | null; onClose: () => void;
}) {
  const actor = useActor();
  const toast = useToast();
  const refresh = useInboxRefresh();
  const isSale = actor.role === 'sale';
  const isAdmin = actor.role === 'admin';
  const b2b = pipeline === 'b2b';
  const [form, setForm] = useState(() => prefill(intake, fallbackName));
  const [next, setNext] = useState(() => emptyNextAction(b2b ? 'Gọi giới thiệu và xác nhận nhu cầu' : 'Gọi liên hệ và xác nhận nhu cầu học'));
  const [linking, setLinking] = useState(false);
  const set = (key: keyof ClassifyForm) => (e: { target: { value: string } }) => setForm((v) => ({ ...v, [key]: e.target.value }));

  const classify = useMutation<ClassifyIntakeResult, ApiFailure, boolean>({
    mutationFn: (confirmNotDuplicate) => classifyIntake(intake.id, pipeline, b2b
      ? {
        contactName: form.contactName, phone: opt(form.phone), email: opt(form.email), companyName: opt(form.companyName),
        taxCode: opt(form.taxCode), needSummary: form.needSummary, confirmNotDuplicate,
        nextAction: isSale ? nextActionPayload(next) : undefined,
      }
      : {
        contactName: form.contactName, phone: opt(form.phone), email: opt(form.email), needSummary: form.needSummary,
        sourceNote: opt(form.sourceNote), nextAction: nextActionPayload(next), ownerUserId: isAdmin ? opt(form.ownerUserId) : undefined,
      }),
    onSuccess: () => {
      toast(b2b ? 'Đã tạo lead B2B và gắn hội thoại vào khách' : 'Đã tạo lead học viên và gắn hội thoại vào khách');
      onClose();
    },
    onSettled: refresh,
  });
  const errors = fieldErrors(classify.error);
  const duplicates = duplicateMatches(classify.error);
  const submit = (e: FormEvent) => { e.preventDefault(); classify.mutate(false); };
  const formId = `classify-${intake.id}`;

  if (linking) {
    return (
      <Modal open title="Gắn vào khách có sẵn" onClose={onClose} footer={<button className="btn" onClick={() => setLinking(false)}>Quay lại form</button>}>
        <ContactLinker intakeId={intake.id} initialQuery={form.phone || form.contactName} onDone={onClose} />
      </Modal>
    );
  }
  return (
    <Modal open title={PIPELINE_LABEL[pipeline]} onClose={onClose} footer={<>
      <button type="button" className="btn" onClick={onClose}>Hủy</button>
      <button type="submit" form={formId} className="btn btn-primary" disabled={classify.isPending}>
        {classify.isPending ? 'Đang tạo…' : 'Tạo lead'}
      </button>
    </>}>
      <form id={formId} className="stack" onSubmit={submit}>
        <p className="small text-2">Đã điền sẵn từ thông tin bot trích. Kiểm tra lại trước khi tạo; nguồn lead lấy theo kênh {intake.channel === 'facebook' ? 'Facebook' : 'Zalo'}.</p>
        <div className="grid-2">
          <Field label={b2b ? 'Tên người liên hệ' : 'Họ tên'} required error={errors.contactName} htmlFor={`${formId}-name`}>
            <input id={`${formId}-name`} type="text" maxLength={120} value={form.contactName} onChange={set('contactName')} required
              aria-invalid={Boolean(errors.contactName)} autoComplete="off" />
          </Field>
          <Field label="Số điện thoại" error={errors.phone} hint={b2b ? 'Cần SĐT hoặc email. Dùng để kiểm trùng.' : 'Dùng để kiểm trùng khách.'} htmlFor={`${formId}-phone`}>
            <input id={`${formId}-phone`} type="tel" inputMode="tel" maxLength={20} value={form.phone} onChange={set('phone')}
              aria-invalid={Boolean(errors.phone)} autoComplete="off" />
          </Field>
          <Field label="Email" error={errors.email} htmlFor={`${formId}-email`}>
            <input id={`${formId}-email`} type="email" maxLength={160} value={form.email} onChange={set('email')}
              aria-invalid={Boolean(errors.email)} autoComplete="off" />
          </Field>
          {b2b ? (
            <>
              <Field label="Công ty" error={errors.companyName} hint="Bắt buộc khi có mã số thuế." htmlFor={`${formId}-company`}>
                <input id={`${formId}-company`} type="text" maxLength={200} value={form.companyName} onChange={set('companyName')}
                  aria-invalid={Boolean(errors.companyName)} autoComplete="off" />
              </Field>
              <Field label="Mã số thuế" error={errors.taxCode} htmlFor={`${formId}-tax`}>
                <input id={`${formId}-tax`} type="text" inputMode="numeric" maxLength={20} value={form.taxCode} onChange={set('taxCode')} autoComplete="off" />
              </Field>
            </>
          ) : (
            <Field label="Ghi chú nguồn" error={errors.sourceNote} htmlFor={`${formId}-note`}>
              <input id={`${formId}-note`} type="text" maxLength={200} value={form.sourceNote} onChange={set('sourceNote')} autoComplete="off" />
            </Field>
          )}
          {!b2b && isAdmin && <OwnerField id={`${formId}-owner`} value={form.ownerUserId} onChange={set('ownerUserId')} error={errors.ownerUserId} />}
        </div>
        <Field label="Nhu cầu" required error={errors.needSummary} htmlFor={`${formId}-need`}>
          <textarea id={`${formId}-need`} maxLength={NEED_MAX} value={form.needSummary} onChange={set('needSummary')} required
            aria-invalid={Boolean(errors.needSummary)} />
        </Field>
        {(!b2b || isSale) && <NextActionFields value={next} onChange={setNext} errors={errors} legend="Next Action đầu tiên" />}

        {duplicates && (
          <div className="alert" data-tone="warn" role="alert" style={{ flexDirection: 'column' }}>
            <strong>Có thể trùng với lead đã có</strong>
            <DuplicateMatches matches={duplicates} />
            <span>Nếu cùng khách, gắn hội thoại vào khách có sẵn. Nếu chắc chắn là khách khác, vẫn tạo lead mới.</span>
            <div className="row-wrap" style={{ marginTop: 6 }}>
              <button type="button" className="btn btn-sm" onClick={() => classify.mutate(true)} disabled={classify.isPending}>Vẫn tạo lead mới</button>
              <button type="button" className="btn btn-sm" onClick={() => setLinking(true)} disabled={classify.isPending}>Gắn vào khách có sẵn</button>
            </div>
          </div>
        )}
        {!duplicates && <FormError error={classify.error && !Object.keys(errors).length ? classify.error : null} />}
        {!duplicates && Object.keys(errors).length > 0 && <Alert tone="danger">Kiểm tra lại các trường được đánh dấu.</Alert>}
      </form>
    </Modal>
  );
}

/** Admin creates a learner lead for a chosen Sale or Leader; mounted only then, so others never load the list. */
function OwnerField({ id, value, onChange, error }: { id: string; value: string; onChange: (e: { target: { value: string } }) => void; error?: string }) {
  const owners = useOwnerOptions();
  return (
    <Field label="Sale phụ trách" required error={error} htmlFor={id}>
      <select id={id} value={value} onChange={onChange} required>
        <option value="">Chọn sale</option>
        {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </Field>
  );
}

/** Finds a customer in the actor's scope (name or phone) and links the intake's conversation to it. */
function ContactLinker({ intakeId, initialQuery, onDone }: { intakeId: string; initialQuery: string; onDone: () => void }) {
  const actor = useActor();
  const toast = useToast();
  const refresh = useInboxRefresh();
  const [q, setQ] = useState(initialQuery);
  const query = useDebounced(q.trim(), 300);
  const allowed = LINK_ROLES.includes(actor.role);
  const results = useApi<LearnerList>(allowed && query.length >= 2 ? `/learners?q=${encodeURIComponent(query)}` : null);
  const link = useMutation<unknown, ApiFailure, string>({
    mutationFn: (contactId) => linkIntakeContact(intakeId, contactId),
    onSuccess: () => { toast('Đã gắn hội thoại vào khách có sẵn'); onDone(); },
    onSettled: refresh,
  });
  if (!allowed) return <Alert tone="warn">Vai trò hiện tại không gắn được khách có sẵn. Nhờ Sale phụ trách khách hoặc Admin.</Alert>;
  const items = results.data?.items ?? [];
  return (
    <div className="stack">
      <Field label="Tìm khách" hint="Tên hoặc số điện thoại, trong các khách thuộc phạm vi của bạn." htmlFor={`link-${intakeId}`}>
        <input id={`link-${intakeId}`} type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      </Field>
      <FormError error={link.error} />
      {results.isLoading && <Loading rows={2} />}
      {results.error && <ErrorState error={results.error} onRetry={() => results.refetch()} />}
      {results.data && !items.length && <p className="small muted">Không tìm thấy khách trong phạm vi của bạn.</p>}
      {!!items.length && (
        <ul className="intake-contacts">
          {items.map((c) => (
            <li key={c.contactId} className="row">
              <div className="truncate" style={{ flex: 1 }}>
                <div className="truncate" style={{ fontWeight: 600 }}>{c.name}</div>
                <div className="small muted truncate">{[c.phone, c.ownerName && `Phụ trách: ${c.ownerName}`].filter(Boolean).join(' · ')}</div>
              </div>
              <button className="btn btn-sm btn-primary" disabled={link.isPending} onClick={() => link.mutate(c.contactId)}
                aria-label={`Gắn vào ${c.name}`}>Gắn</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DiscardDialog({ intakeId, onClose }: { intakeId: string; onClose: () => void }) {
  const toast = useToast();
  const refresh = useInboxRefresh();
  const discard = useMutation<unknown, ApiFailure>({
    mutationFn: () => discardIntake(intakeId),
    onSuccess: () => { toast('Đã bỏ qua lead chờ phân loại'); onClose(); },
    onSettled: refresh,
  });
  return (
    <Modal open title="Bỏ qua lead chờ phân loại?" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Hủy</button>
      <button className="btn btn-danger" disabled={discard.isPending} onClick={() => discard.mutate()}>Bỏ qua</button>
    </>}>
      <p className="text-2">Không tạo lead nào từ thông tin này. Lần trích sau (hoặc khi bấm “Cập nhật CRM”) có thể tạo một lead chờ phân loại mới.</p>
      <FormError error={discard.error} />
    </Modal>
  );
}
