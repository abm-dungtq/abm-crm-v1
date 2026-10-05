import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
  CHARGE_KINDS, PAYMENT_METHODS, chargeKindLabel,
  type ChargeKind, type CreateChargeInput, type PaymentMethod, type RecordPaymentInput, type SetInvoiceRefInput, type VoidChargeInput,
} from '@abm/contracts';
import { useActor } from '../actor-context';
import { useApi, useCommand } from '../api';
import { Badge, Empty, ErrorState, Field, FormError, Loading, Modal, fieldErrors, useToast } from '../components/ui';
import { fmtDateTime, fmtMoney, fromLocalInput, toLocalInput } from '../format';

const canWriteMoney = (role: string) => role === 'accountant' || role === 'admin';

interface ChargeRow {
  id: string;
  code: string;
  contactId: string;
  contactName: string;
  enrollmentId: string | null;
  kind: string;
  amountVnd: number;
  paid: number;
  remaining: number;
  productName: string | null;
  sessionsCount: number | null;
  note: string | null;
  invoiceRef: string | null;
  status: string;
  version: number;
  createdAt: string;
}

interface FeeContact {
  contactId: string;
  name: string;
  leadId: string;
  leadCode: string;
  enrollmentId: string | null;
  className: string | null;
  courseName: string | null;
  productName: string | null;
}

export function FeesPage() {
  const actor = useActor();
  const writable = canWriteMoney(actor.role);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [invoice, setInvoice] = useState<ChargeRow | null>(null);
  const [voiding, setVoiding] = useState<ChargeRow | null>(null);
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (q.trim()) params.set('q', q.trim());
  const suffix = params.toString();
  const list = useApi<ChargeRow[]>(`/fees/charges${suffix ? `?${suffix}` : ''}`);
  const rows = list.data ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Học phí</h1>
          <p className="sub">Khoản phải thu và tiền vào. Số còn lại tính từ phân bổ, không lưu thành số dư.</p>
        </div>
      </div>
      {list.isLoading && <Loading rows={4} />}
      {list.error && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
      {list.data && (
        <div className="cols-main">
          <div className="card">
            <div className="card-head">
              <h2>Khoản phải thu</h2>
              <span className="spacer" />
              <input aria-label="Tìm khoản phải thu" placeholder="Mã hoặc tên" value={q} onChange={(e) => setQ(e.target.value)} />
              <select aria-label="Trạng thái khoản" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Mọi trạng thái</option>
                <option value="open">Đang mở</option>
                <option value="void">Đã hủy</option>
              </select>
            </div>
            {rows.length === 0 && <Empty title="Chưa có khoản phải thu" />}
            {rows.length > 0 && (
              <div className="table-wrap">
                <table className="table responsive">
                  <thead>
                    <tr>
                      <th>Học viên</th><th>Loại</th><th className="right">Phải thu</th><th className="right">Đã phân bổ</th><th className="right">Còn lại</th><th>Hóa đơn</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <div className="cell-title">{row.contactName}</div>
                          <div className="cell-sub mono">{row.code}{row.productName ? ` · ${row.productName}` : ''}</div>
                        </td>
                        <td data-label="Loại">{chargeKindLabel(row.kind)}{row.status === 'void' && <> <Badge tone="neutral">Đã hủy</Badge></>}</td>
                        <td data-label="Phải thu" className="right num">{fmtMoney(row.amountVnd, false)}</td>
                        <td data-label="Đã phân bổ" className="right num">{fmtMoney(row.paid, false)}</td>
                        <td data-label="Còn lại" className="right num">{fmtMoney(row.remaining, false)}</td>
                        <td data-label="Hóa đơn">{row.invoiceRef ?? '—'}</td>
                        <td className="right">
                          <div className="row-wrap">
                            <Link to="/fees/ledger/$contactId" params={{ contactId: row.contactId }} className="btn btn-sm">Sổ tiền</Link>
                            <Link to="/fees/guide/$chargeId" params={{ chargeId: row.id }} className="btn btn-sm">Hướng dẫn chuyển khoản</Link>
                            {writable && row.status === 'open' && <button className="btn btn-sm" onClick={() => setInvoice(row)}>Số hóa đơn</button>}
                            {writable && row.status === 'open' && <button className="btn btn-sm btn-danger" onClick={() => setVoiding(row)}>Hủy khoản</button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {writable && (
            <div className="stack">
              <ChargeForm />
              <PaymentForm />
            </div>
          )}
        </div>
      )}
      {invoice && <InvoiceDialog charge={invoice} onClose={() => setInvoice(null)} />}
      {voiding && <VoidChargeDialog charge={voiding} onClose={() => setVoiding(null)} />}
    </>
  );
}

function ChargeForm() {
  const toast = useToast();
  const [contactQ, setContactQ] = useState('');
  const [leadId, setLeadId] = useState('');
  const [form, setForm] = useState({ kind: 'tuition' as ChargeKind, amount: '', sessions: '', note: '' });
  const contacts = useApi<FeeContact[]>(`/fees/contacts?q=${encodeURIComponent(contactQ.trim())}`);
  const selected = contacts.data?.find((row) => row.leadId === leadId) ?? null;
  const m = useCommand<CreateChargeInput>('createCharge');
  const errors = fieldErrors(m.error);
  const submit = () => {
    if (!selected) return;
    m.mutate({
      contactId: selected.contactId,
      enrollmentId: selected.enrollmentId ?? undefined,
      kind: form.kind,
      amountVnd: Number(form.amount),
      sessionsCount: form.sessions.trim() ? Number(form.sessions) : undefined,
      note: form.note.trim() || undefined,
    }, { onSuccess: () => { toast('Đã tạo khoản phải thu'); setForm({ kind: 'tuition', amount: '', sessions: '', note: '' }); setLeadId(''); } });
  };

  return (
    <section className="card">
      <div className="card-head"><h2>Tạo khoản phải thu</h2></div>
      <form className="card-body stack" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label="Tìm học viên" htmlFor="fee-q">
          <input id="fee-q" value={contactQ} onChange={(e) => { setContactQ(e.target.value); setLeadId(''); }} placeholder="Tên hoặc mã lead" />
        </Field>
        <Field label="Học viên và ghi danh" htmlFor="fee-who" required error={errors.contactId ?? errors.enrollmentId}>
          <select id="fee-who" value={leadId} onChange={(e) => setLeadId(e.target.value)} required>
            <option value="">Chọn học viên</option>
            {(contacts.data ?? []).map((row) => (
              <option key={row.leadId} value={row.leadId}>
                {row.name} · {row.leadCode} · {row.className ?? 'Chưa ghi danh'}{row.productName ? ` · ${row.productName}` : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Loại" htmlFor="fee-kind" required error={errors.kind}>
          <select id="fee-kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as ChargeKind })}>
            {CHARGE_KINDS.map((kind) => <option key={kind.code} value={kind.code}>{kind.label}</option>)}
          </select>
        </Field>
        <Field label="Số tiền (đồng)" htmlFor="fee-amount" required error={errors.amountVnd} hint={form.kind === 'adjustment' ? 'Điều chỉnh âm là giảm giá. Không sửa khoản học phí đã tạo.' : undefined}>
          <input id="fee-amount" type="number" step={1} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
        </Field>
        <Field label="Số buổi" htmlFor="fee-sessions">
          <input id="fee-sessions" type="number" min={1} step={1} value={form.sessions} onChange={(e) => setForm({ ...form, sessions: e.target.value })} />
        </Field>
        <Field label="Ghi chú" htmlFor="fee-note" error={errors.note}>
          <textarea id="fee-note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={1000} />
        </Field>
        <FormError error={m.error && !Object.keys(errors).length ? m.error : null} />
        <button className="btn btn-primary" disabled={m.isPending || !selected}>{m.isPending ? 'Đang lưu…' : 'Tạo khoản'}</button>
      </form>
    </section>
  );
}

function PaymentForm() {
  const toast = useToast();
  const [contactQ, setContactQ] = useState('');
  const [form, setForm] = useState({
    direction: 'in' as 'in' | 'refund', method: 'transfer' as PaymentMethod, amount: '', receivedAt: toLocalInput(new Date()), memo: '', payerNote: '', contactId: '',
  });
  const contacts = useApi<FeeContact[]>(form.direction === 'refund' ? `/fees/contacts?q=${encodeURIComponent(contactQ.trim())}` : null);
  const people = [...new Map((contacts.data ?? []).map((row) => [row.contactId, row])).values()];
  const m = useCommand<RecordPaymentInput>('recordPayment');
  const errors = fieldErrors(m.error);
  const submit = () => m.mutate({
    direction: form.direction, method: form.method, amountVnd: Number(form.amount), receivedAt: fromLocalInput(form.receivedAt),
    memo: form.memo.trim() || undefined, payerNote: form.payerNote.trim() || undefined,
    contactId: form.direction === 'refund' && form.contactId ? form.contactId : undefined,
  }, { onSuccess: () => { toast(form.direction === 'refund' ? 'Đã ghi hoàn tiền' : 'Đã ghi tiền vào'); setForm({ ...form, amount: '', memo: '', payerNote: '', contactId: '' }); } });

  return (
    <section className="card">
      <div className="card-head"><h2>Ghi tiền vào hoặc hoàn tiền</h2></div>
      <form className="card-body stack" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label="Chiều" htmlFor="pay-dir" required>
          <select id="pay-dir" value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value as 'in' | 'refund', contactId: '' })}>
            <option value="in">Tiền vào</option>
            <option value="refund">Hoàn tiền</option>
          </select>
        </Field>
        <Field label="Hình thức" htmlFor="pay-method" required error={errors.method}>
          <select id="pay-method" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value as PaymentMethod })}>
            {PAYMENT_METHODS.map((method) => <option key={method.code} value={method.code}>{method.label}</option>)}
          </select>
        </Field>
        <Field label="Số tiền (đồng)" htmlFor="pay-amount" required error={errors.amountVnd}>
          <input id="pay-amount" type="number" min={1} step={1} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
        </Field>
        <Field label="Thời điểm nhận" htmlFor="pay-at" required error={errors.receivedAt}>
          <input id="pay-at" type="datetime-local" value={form.receivedAt} onChange={(e) => setForm({ ...form, receivedAt: e.target.value })} required />
        </Field>
        <Field label="Nội dung" htmlFor="pay-memo" hint="Đúng một mã HP###### thì tiền vào tự phân bổ khi khoản còn đủ." error={errors.memo}>
          <input id="pay-memo" value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} maxLength={500} />
        </Field>
        <Field label="Ghi chú người nộp" htmlFor="pay-note" error={errors.payerNote}>
          <input id="pay-note" value={form.payerNote} onChange={(e) => setForm({ ...form, payerNote: e.target.value })} maxLength={500} />
        </Field>
        {form.direction === 'refund' && (
          <>
            <Field label="Tìm học viên" htmlFor="pay-q">
              <input id="pay-q" value={contactQ} onChange={(e) => { setContactQ(e.target.value); setForm({ ...form, contactId: '' }); }} placeholder="Tên hoặc mã lead" />
            </Field>
            <Field label="Học viên của khoản hoàn" htmlFor="pay-who" error={errors.contactId} hint="Có học viên thì hoàn tiền hiện trong sổ tiền của học viên đó. Hoàn tiền không được phân bổ.">
              <select id="pay-who" value={form.contactId} onChange={(e) => setForm({ ...form, contactId: e.target.value })}>
                <option value="">Không gắn học viên</option>
                {people.map((row) => <option key={row.contactId} value={row.contactId}>{row.name} · {row.leadCode}</option>)}
              </select>
            </Field>
          </>
        )}
        <FormError error={m.error && !Object.keys(errors).length ? m.error : null} />
        <button className="btn btn-primary" disabled={m.isPending}>{m.isPending ? 'Đang lưu…' : 'Ghi nhận'}</button>
      </form>
    </section>
  );
}

function VoidChargeDialog({ charge, onClose }: { charge: ChargeRow; onClose: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const m = useCommand<VoidChargeInput>('voidCharge');
  const errors = fieldErrors(m.error);
  const submit = () => m.mutate({ chargeId: charge.id, version: charge.version, reason: reason.trim() }, {
    onSuccess: () => { toast('Đã hủy khoản'); onClose(); },
  });
  return (
    <Modal open title={`Hủy khoản · ${charge.code}`} onClose={onClose} footer={
      <button className="btn btn-danger" disabled={m.isPending || !reason.trim()} onClick={submit}>{m.isPending ? 'Đang lưu…' : 'Hủy khoản'}</button>
    }>
      <p className="small muted">{charge.contactName}. Chỉ hủy được khoản không còn phân bổ đang hiệu lực.</p>
      <Field label="Lý do" htmlFor="fee-void-reason" required error={errors.reason}>
        <textarea id="fee-void-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required />
      </Field>
      <FormError error={m.error && !Object.keys(errors).length ? m.error : null} />
    </Modal>
  );
}

function InvoiceDialog({ charge, onClose }: { charge: ChargeRow; onClose: () => void }) {
  const toast = useToast();
  const [invoiceRef, setInvoiceRef] = useState(charge.invoiceRef ?? '');
  const m = useCommand<SetInvoiceRefInput>('setInvoiceRef');
  const errors = fieldErrors(m.error);
  const submit = () => m.mutate({ chargeId: charge.id, version: charge.version, invoiceRef: invoiceRef.trim() }, {
    onSuccess: () => { toast('Đã lưu số hóa đơn'); onClose(); },
  });
  return (
    <Modal open title={`Số hóa đơn · ${charge.code}`} onClose={onClose} footer={
      <button className="btn btn-primary" disabled={m.isPending || !invoiceRef.trim()} onClick={submit}>{m.isPending ? 'Đang lưu…' : 'Lưu'}</button>
    }>
      <p className="small muted">{charge.contactName} · ghi lúc {fmtDateTime(charge.createdAt, true)}. Số hóa đơn chỉ là tham chiếu.</p>
      <Field label="Số hóa đơn" htmlFor="inv-ref" required error={errors.invoiceRef}>
        <input id="inv-ref" value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} maxLength={60} required />
      </Field>
      <FormError error={m.error && !Object.keys(errors).length ? m.error : null} />
    </Modal>
  );
}
