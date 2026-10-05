import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { LEAD_SOURCES, type CreateLearnerLeadInput, type LeadSourceCode } from '@abm/contracts';
import { useActor } from '../actor-context';
import { useApi, useCommand } from '../api';
import { NextActionFields, emptyNextAction, nextActionPayload } from '../components/lead-actions';
import { Alert, Field, FormError, fieldErrors, useToast } from '../components/ui';
import type { PartnerRow, ProductItem } from '../types';
import { useOwnerOptions } from './learners';

export function LearnerNewPage() {
  const actor = useActor();
  const navigate = useNavigate();
  const toast = useToast();
  const isAdmin = actor.role === 'admin';
  const [form, setForm] = useState({
    contactName: '', phone: '', email: '', source: 'facebook' as LeadSourceCode, partnerContractId: '', sourceNote: '', needSummary: '', ownerUserId: '',
  });
  const [productIds, setProductIds] = useState<string[]>([]);
  const [next, setNext] = useState(emptyNextAction('Gọi liên hệ và xác nhận nhu cầu học'));
  const products = useApi<ProductItem[]>('/products');
  const partners = useApi<PartnerRow[]>(form.source === 'partner' ? '/partners' : null);
  const owners = useOwnerOptions();
  const mutation = useCommand<CreateLearnerLeadInput, { leadId: string; contactId: string }>('createLearnerLead');
  const errors = fieldErrors(mutation.error);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const activeContracts = (partners.data ?? []).filter((p) => p.status === 'active');
  const sellable = (products.data ?? []).filter((p) => p.active);
  const opt = (v: string) => v.trim() || undefined;

  const submit = () => mutation.mutate({
    contactName: form.contactName, phone: opt(form.phone), email: opt(form.email), source: form.source,
    partnerContractId: form.source === 'partner' ? opt(form.partnerContractId) : undefined,
    sourceNote: opt(form.sourceNote), needSummary: form.needSummary, productIds: productIds.length ? productIds : undefined,
    nextAction: nextActionPayload(next), ownerUserId: isAdmin ? opt(form.ownerUserId) : undefined,
  }, {
    onSuccess: (r) => {
      toast('Đã tạo lead học viên');
      void navigate({ to: '/learners/$contactId', params: { contactId: r.contactId } });
    },
  });

  return (
    <>
      <div className="page-head">
        <div>
          <div className="small"><Link to="/learners">Học viên</Link> / Tạo mới</div>
          <h1>Tạo lead học viên</h1>
          <p className="sub">Khách mới được giữ 3 tháng cho người phụ trách. Trùng số điện thoại với khách đang do người khác giữ sẽ bị từ chối.</p>
        </div>
      </div>
      <form className="card" style={{ maxWidth: 760 }} onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="card-body stack">
          <div className="grid-2">
            <Field label="Họ tên" required error={errors.contactName} htmlFor="ln-name">
              <input id="ln-name" type="text" value={form.contactName} onChange={set('contactName')} required autoComplete="off" />
            </Field>
            <Field label="Nguồn" required htmlFor="ln-source">
              <select id="ln-source" value={form.source} onChange={set('source')}>
                {LEAD_SOURCES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Số điện thoại" error={errors.phone} hint="Dùng để kiểm trùng khách." htmlFor="ln-phone">
              <input id="ln-phone" type="tel" inputMode="tel" value={form.phone} onChange={set('phone')} autoComplete="off" />
            </Field>
            <Field label="Email" error={errors.email} htmlFor="ln-email">
              <input id="ln-email" type="email" value={form.email} onChange={set('email')} autoComplete="off" />
            </Field>
            {form.source === 'partner' && (
              <Field label="Hợp đồng đối tác" required error={errors.partnerContractId}
                hint={activeContracts.length ? undefined : 'Chưa có hợp đồng đang hiệu lực. Tạo ở mục Đối tác.'} htmlFor="ln-contract">
                <select id="ln-contract" value={form.partnerContractId} onChange={set('partnerContractId')} required>
                  <option value="">Chọn hợp đồng</option>
                  {activeContracts.map((p) => <option key={p.id} value={p.id}>{p.accountName} · {p.name}</option>)}
                </select>
              </Field>
            )}
            <Field label="Ghi chú nguồn" htmlFor="ln-note" hint="VD: tên sự kiện, người giới thiệu.">
              <input id="ln-note" type="text" value={form.sourceNote} onChange={set('sourceNote')} maxLength={200} autoComplete="off" />
            </Field>
            {isAdmin && (
              <Field label="Sale phụ trách" required error={errors.ownerUserId} htmlFor="ln-owner">
                <select id="ln-owner" value={form.ownerUserId} onChange={set('ownerUserId')} required>
                  <option value="">Chọn sale</option>
                  {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </Field>
            )}
          </div>
          <Field label="Nhu cầu" required error={errors.needSummary} htmlFor="ln-need">
            <textarea id="ln-need" value={form.needSummary} onChange={set('needSummary')} required placeholder="Học viên muốn học gì, mục tiêu, thời gian…" />
          </Field>
          <fieldset className="stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field-label" style={{ marginBottom: 6 }}>Sản phẩm quan tâm</legend>
            {errors.productIds && <span className="field-error" role="alert">{errors.productIds}</span>}
            {products.data && sellable.length === 0 && <span className="field-hint">Chưa có sản phẩm đang bán.</span>}
            <div className="chips">
              {sellable.map((p) => (
                <button type="button" key={p.id} className="chip" aria-pressed={productIds.includes(p.id)}
                  onClick={() => setProductIds((ids) => (ids.includes(p.id) ? ids.filter((i) => i !== p.id) : [...ids, p.id]))}>{p.name}</button>
              ))}
            </div>
          </fieldset>
          <NextActionFields value={next} onChange={setNext} errors={errors} legend="Next Action đầu tiên" />
          <FormError error={mutation.error && !Object.keys(errors).length ? mutation.error : null} />
          {Object.keys(errors).length > 0 && <Alert tone="danger">Kiểm tra lại các trường được đánh dấu.</Alert>}
        </div>
        <div className="card-foot row">
          <span className="spacer" />
          <Link to="/learners" className="btn">Hủy</Link>
          <button className="btn btn-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Đang tạo…' : 'Tạo lead'}</button>
        </div>
      </form>
    </>
  );
}
