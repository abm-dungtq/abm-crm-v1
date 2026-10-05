import { useState } from 'react';
import { paymentMethodLabel, type AllocatePaymentInput } from '@abm/contracts';
import { useActor } from '../actor-context';
import { useApi, useCommand } from '../api';
import { Empty, ErrorState, Field, FormError, Loading, fieldErrors, useToast } from '../components/ui';
import { fmtDateTime, fmtMoney } from '../format';

const canWriteMoney = (role: string) => role === 'accountant' || role === 'admin';

interface ChargeOption { id: string; code: string; contactName: string; remaining: number; status: string }
interface UnallocatedPayment {
  id: string;
  method: string;
  amountVnd: number;
  remaining: number;
  receivedAt: string;
  memo: string | null;
  payerNote: string | null;
  version: number;
}

export function FeesQueuePage() {
  const actor = useActor();
  const writable = canWriteMoney(actor.role);
  const queue = useApi<UnallocatedPayment[]>('/fees/payments?unallocated=1');
  const charges = useApi<ChargeOption[]>(writable ? '/fees/charges?status=open' : null);
  const rows = queue.data ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tiền chưa khớp</h1>
          <p className="sub">Tiền vào còn phần chưa phân bổ. Hoàn tiền không nằm ở đây vì không được phân bổ.</p>
        </div>
      </div>
      {queue.isLoading && <Loading rows={3} />}
      {queue.error && <ErrorState error={queue.error} onRetry={() => queue.refetch()} />}
      {queue.data && rows.length === 0 && <Empty title="Không còn khoản tiền chưa khớp" />}
      {queue.data && rows.length > 0 && (
        <div className="stack">
          {rows.map((payment) => (
            <section className="card" key={payment.id}>
              <div className="card-head">
                <h2>{fmtMoney(payment.amountVnd, false)}</h2>
                <span className="spacer" />
                <span className="small muted">{paymentMethodLabel(payment.method)} · {fmtDateTime(payment.receivedAt, true)}</span>
              </div>
              <div className="card-body stack">
                <p className="small">Còn lại {fmtMoney(payment.remaining, false)}{payment.memo ? ` · ${payment.memo}` : ''}{payment.payerNote ? ` · ${payment.payerNote}` : ''}</p>
                {writable && <AllocateForm payment={payment} charges={(charges.data ?? []).filter((row) => row.status === 'open' && row.remaining > 0)} />}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function AllocateForm({ payment, charges }: { payment: UnallocatedPayment; charges: ChargeOption[] }) {
  const toast = useToast();
  const [lines, setLines] = useState<{ key: number; chargeId: string; amount: string }[]>([{ key: 1, chargeId: '', amount: '' }]);
  const [nextKey, setNextKey] = useState(2);
  const m = useCommand<AllocatePaymentInput>('allocatePayment');
  const errors = fieldErrors(m.error);
  const typed = lines.reduce((sum, line) => sum + (line.amount.trim() ? Number(line.amount) : 0), 0);
  const left = payment.remaining - (Number.isFinite(typed) ? typed : 0);
  const ids = lines.map((line) => line.chargeId).filter(Boolean);
  const duplicate = ids.length !== new Set(ids).size;
  const ready = lines.every((line) => line.chargeId && Number.isInteger(Number(line.amount)) && Number(line.amount) > 0) && !duplicate && left >= 0;
  const setLine = (key: number, patch: Partial<{ chargeId: string; amount: string }>) => setLines(lines.map((line) => line.key === key ? { ...line, ...patch } : line));
  const submit = () => m.mutate({
    paymentId: payment.id,
    version: payment.version,
    allocations: lines.map((line) => ({ chargeId: line.chargeId, amountVnd: Number(line.amount) })),
  }, { onSuccess: () => toast('Đã phân bổ') });

  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      {lines.map((line, index) => (
        <div className="row-wrap" key={line.key}>
          <Field label={index === 0 ? 'Khoản phải thu' : 'Khoản'} htmlFor={`alloc-${line.key}`}>
            <select id={`alloc-${line.key}`} value={line.chargeId} onChange={(e) => setLine(line.key, { chargeId: e.target.value })} required>
              <option value="">Chọn khoản</option>
              {charges.map((charge) => (
                <option key={charge.id} value={charge.id}>{charge.code} · {charge.contactName} · còn {fmtMoney(charge.remaining, false)}</option>
              ))}
            </select>
          </Field>
          <Field label="Số tiền" htmlFor={`amt-${line.key}`}>
            <input id={`amt-${line.key}`} type="number" min={1} step={1} value={line.amount} onChange={(e) => setLine(line.key, { amount: e.target.value })} required />
          </Field>
          {lines.length > 1 && <button type="button" className="btn btn-sm" onClick={() => setLines(lines.filter((item) => item.key !== line.key))}>Bỏ</button>}
        </div>
      ))}
      <p className={left < 0 ? 'field-error' : 'small'}>Còn lại của khoản thu sau khi gõ: {fmtMoney(left, false)}{duplicate ? ' · Mỗi khoản chỉ một dòng' : ''}</p>
      <div className="row-wrap">
        <button type="button" className="btn btn-sm" disabled={lines.length >= 50} onClick={() => { setLines([...lines, { key: nextKey, chargeId: '', amount: '' }]); setNextKey(nextKey + 1); }}>Thêm dòng</button>
        <button className="btn btn-primary" disabled={m.isPending || !ready}>{m.isPending ? 'Đang lưu…' : 'Phân bổ'}</button>
      </div>
      <FormError error={errors.allocations ? null : m.error} />
      {errors.allocations && <p className="field-error" role="alert">{errors.allocations}</p>}
    </form>
  );
}
