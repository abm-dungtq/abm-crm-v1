import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { LEAD_SOURCES, type CreateLeadInput, type LeadSourceCode } from '@abm/contracts';
import { useActor } from '../actor-context';
import { ApiFailure, useCommand } from '../api';
import { NextActionFields, emptyNextAction, nextActionPayload } from '../components/lead-actions';
import { Alert, Field, FormError, fieldErrors, useToast } from '../components/ui';

/**
 * Matches outside the viewer's scope come back without code, stage or owner. `contactId` and `contactName` name the
 * matched customer only when the viewer may work on it (the customer scope), so it can be linked directly.
 */
export interface DuplicateMatch {
  field: string; code: string | null; stage: string | null; owner: string | null; contactId?: string; contactName?: string;
}
const FIELD_LABEL: Record<string, string> = { phone: 'Số điện thoại', email: 'Email', tax_code: 'Mã số thuế', company: 'Tên công ty' };

/** Matches of a DUPLICATE_SUSPECTED error, or null for any other error. */
export const duplicateMatches = (error: unknown) =>
  (error instanceof ApiFailure && error.code === 'DUPLICATE_SUSPECTED' ? (error.error.details as DuplicateMatch[] | undefined) ?? [] : null);

export function DuplicateMatches({ matches }: { matches: DuplicateMatch[] }) {
  return (
    <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
      {matches.map((d, i) => <li key={i}>{FIELD_LABEL[d.field] ?? d.field} trùng {d.code
        ? <><span className="mono">{d.code}</span> · {d.stage} · {d.owner}</>
        : 'một lead đã có trong hệ thống, ngoài phạm vi của bạn (hỏi Leader)'}</li>)}
    </ul>
  );
}

export function LeadNewPage() {
  const actor = useActor();
  const navigate = useNavigate();
  const toast = useToast();
  const isSale = actor.role === 'sale';
  const [form, setForm] = useState({ contactName: '', phone: '', email: '', companyName: '', taxCode: '', source: (isSale ? 'self' : 'website') as LeadSourceCode, needSummary: '' });
  const [next, setNext] = useState(emptyNextAction('Gọi giới thiệu và xác nhận nhu cầu'));
  const mutation = useCommand<CreateLeadInput, { leadId: string }>('createLead');
  const errors = fieldErrors(mutation.error);
  const duplicates = duplicateMatches(mutation.error);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = (confirmNotDuplicate = false) => {
    const opt = (v: string) => v.trim() || undefined;
    mutation.mutate({
      contactName: form.contactName, phone: opt(form.phone), email: opt(form.email), companyName: opt(form.companyName),
      taxCode: opt(form.taxCode), source: form.source, needSummary: form.needSummary, confirmNotDuplicate,
      nextAction: isSale ? nextActionPayload(next) : undefined,
    }, {
      onSuccess: (r) => {
        toast(isSale ? 'Đã tạo lead và giao cho bạn' : 'Đã tạo lead vào hàng chờ phòng ban');
        void navigate({ to: '/leads/$leadId', params: { leadId: r.leadId } });
      },
    });
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="small"><Link to="/leads">Lead</Link> / Tạo mới</div>
          <h1>Tạo lead</h1>
          <p className="sub">{isSale ? 'Lead tự khai thác được giao cho bạn ngay, cần Next Action.' : 'Lead vào hàng chờ phòng ban để Leader giao thủ công (QĐ14).'}</p>
        </div>
      </div>
      <form className="card" style={{ maxWidth: 760 }} onSubmit={(e) => { e.preventDefault(); submit(false); }}>
        <div className="card-body stack">
          <div className="grid-2">
            <Field label="Tên người liên hệ" required error={errors.contactName} htmlFor="f-name">
              <input id="f-name" type="text" value={form.contactName} onChange={set('contactName')} required aria-invalid={Boolean(errors.contactName)} autoComplete="off" />
            </Field>
            <Field label="Nguồn" required htmlFor="f-source">
              <select id="f-source" value={form.source} onChange={set('source')}>
                {LEAD_SOURCES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Số điện thoại" error={errors.phone} hint="Cần SĐT hoặc email. Dùng để kiểm trùng." htmlFor="f-phone">
              <input id="f-phone" type="tel" inputMode="tel" value={form.phone} onChange={set('phone')} aria-invalid={Boolean(errors.phone)} autoComplete="off" />
            </Field>
            <Field label="Email" error={errors.email} htmlFor="f-email">
              <input id="f-email" type="email" value={form.email} onChange={set('email')} aria-invalid={Boolean(errors.email)} autoComplete="off" />
            </Field>
            <Field label="Công ty" error={errors.companyName} hint="Bắt buộc khi có mã số thuế." htmlFor="f-company">
              <input id="f-company" type="text" value={form.companyName} onChange={set('companyName')} aria-invalid={Boolean(errors.companyName)} autoComplete="off" />
            </Field>
            <Field label="Mã số thuế" htmlFor="f-tax" hint="Trùng MST sẽ gắn vào khách hàng đã có.">
              <input id="f-tax" type="text" inputMode="numeric" value={form.taxCode} onChange={set('taxCode')} autoComplete="off" />
            </Field>
          </div>
          <Field label="Nhu cầu" required error={errors.needSummary} htmlFor="f-need">
            <textarea id="f-need" value={form.needSummary} onChange={set('needSummary')} required aria-invalid={Boolean(errors.needSummary)} placeholder="Khách cần gì, quy mô, thời điểm…" />
          </Field>
          {isSale && <NextActionFields value={next} onChange={setNext} errors={errors} legend="Next Action đầu tiên" />}

          {duplicates && (
            <div className="alert" data-tone="warn" role="alert" style={{ flexDirection: 'column' }}>
              <strong>Có thể trùng với lead đã có</strong>
              <DuplicateMatches matches={duplicates} />
              <span>Nếu cùng khách, báo owner hiện tại thay vì tạo mới. Nếu chắc chắn là khách khác, xác nhận để tạo.</span>
              <div className="row-wrap" style={{ marginTop: 6 }}>
                <button type="button" className="btn btn-sm" onClick={() => submit(true)} disabled={mutation.isPending}>Không trùng, vẫn tạo</button>
              </div>
            </div>
          )}
          {!duplicates && <FormError error={mutation.error && !Object.keys(errors).length ? mutation.error : null} />}
          {!duplicates && Object.keys(errors).length > 0 && <Alert tone="danger">Kiểm tra lại các trường được đánh dấu.</Alert>}
        </div>
        <div className="card-foot row">
          <span className="spacer" />
          <Link to="/leads" className="btn">Hủy</Link>
          <button className="btn btn-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Đang kiểm trùng…' : 'Tạo lead'}</button>
        </div>
      </form>
    </>
  );
}
