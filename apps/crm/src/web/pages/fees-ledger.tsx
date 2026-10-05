import { useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { chargeKindLabel, paymentMethodLabel, type MoveEnrollmentChargesInput, type RevokeAllocationInput, type VoidChargeInput } from '@abm/contracts';
import { useActor } from '../actor-context';
import { useApi, useCommand } from '../api';
import { Badge, Empty, ErrorState, Field, FormError, Loading, Modal, fieldErrors, useToast } from '../components/ui';
import { fmtDateTime, fmtMoney } from '../format';

const canWriteMoney = (role: string) => role === 'accountant' || role === 'admin';

interface LedgerCharge {
  id: string;
  code: string;
  kind: string;
  amountVnd: number;
  paid: number;
  remaining: number;
  status: string;
  version: number;
  invoiceRef: string | null;
  productName: string | null;
}

interface LedgerPayment {
  id: string;
  direction: string;
  method: string;
  amountVnd: number;
  receivedAt: string;
  memo: string | null;
  allocatedToContact: number;
}

interface LedgerAllocation {
  id: string;
  version: number;
  paymentId: string;
  chargeId: string;
  chargeCode: string;
  amountVnd: number;
  createdAt: string;
}

interface LedgerTransfer {
  fromEnrollmentId: string;
  toEnrollmentId: string;
  version: number;
  fromClassName: string;
  toClassName: string;
  openChargeCount: number;
}

interface Ledger {
  contact: { id: string; name: string };
  charges: LedgerCharge[];
  payments: LedgerPayment[];
  allocations: LedgerAllocation[];
  transfers: LedgerTransfer[];
}

export function FeesLedgerPage() {
  const { contactId } = useParams({ from: '/fees/ledger/$contactId' });
  const actor = useActor();
  const writable = canWriteMoney(actor.role);
  const ledger = useApi<Ledger>(`/fees/contacts/${contactId}`);
  const [voiding, setVoiding] = useState<LedgerCharge | null>(null);
  const [revoking, setRevoking] = useState<LedgerAllocation | null>(null);
  const [moving, setMoving] = useState<LedgerTransfer | null>(null);
  const data = ledger.data;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Sổ tiền học viên</h1>
          <p className="sub">{data ? data.contact.name : 'Khoản phải thu, phân bổ và hoàn tiền của một học viên.'}</p>
        </div>
        <Link to="/fees" className="btn">Về học phí</Link>
      </div>
      {ledger.isLoading && <Loading rows={4} />}
      {ledger.error && <ErrorState error={ledger.error} onRetry={() => ledger.refetch()} />}
      {data && (
        <div className="stack">
          <section className="card">
            <div className="card-head"><h2>Khoản phải thu</h2></div>
            {data.charges.length === 0 && <Empty title="Chưa có khoản phải thu" />}
            {data.charges.length > 0 && (
              <div className="table-wrap">
                <table className="table responsive">
                  <thead>
                    <tr><th>Mã</th><th>Loại</th><th className="right">Phải thu</th><th className="right">Đã phân bổ</th><th className="right">Còn lại</th><th /></tr>
                  </thead>
                  <tbody>
                    {data.charges.map((row) => (
                      <tr key={row.id}>
                        <td><div className="cell-title mono">{row.code}</div>{row.productName && <div className="cell-sub">{row.productName}</div>}</td>
                        <td data-label="Loại">{chargeKindLabel(row.kind)}{row.status === 'void' && <> <Badge tone="neutral">Đã hủy</Badge></>}</td>
                        <td data-label="Phải thu" className="right num">{fmtMoney(row.amountVnd, false)}</td>
                        <td data-label="Đã phân bổ" className="right num">{fmtMoney(row.paid, false)}</td>
                        <td data-label="Còn lại" className="right num">{fmtMoney(row.remaining, false)}</td>
                        <td className="right">
                          {writable && row.status === 'open' && <button className="btn btn-sm btn-danger" onClick={() => setVoiding(row)}>Hủy khoản</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="card">
            <div className="card-head"><h2>Phân bổ đang hiệu lực</h2></div>
            {data.allocations.length === 0 && <Empty title="Chưa có phân bổ" />}
            {data.allocations.length > 0 && (
              <div className="table-wrap">
                <table className="table responsive">
                  <thead>
                    <tr><th>Khoản</th><th className="right">Số tiền</th><th>Ghi lúc</th><th /></tr>
                  </thead>
                  <tbody>
                    {data.allocations.map((row) => (
                      <tr key={row.id}>
                        <td className="mono">{row.chargeCode}</td>
                        <td data-label="Số tiền" className="right num">{fmtMoney(row.amountVnd, false)}</td>
                        <td data-label="Ghi lúc">{fmtDateTime(row.createdAt, true)}</td>
                        <td className="right">
                          {writable && <button className="btn btn-sm btn-danger" onClick={() => setRevoking(row)}>Thu hồi phân bổ</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="card">
            <div className="card-head"><h2>Tiền vào và hoàn tiền</h2></div>
            {data.payments.length === 0 && <Empty title="Chưa có tiền gắn với học viên này" />}
            {data.payments.length > 0 && (
              <div className="table-wrap">
                <table className="table responsive">
                  <thead>
                    <tr><th>Chiều</th><th>Hình thức</th><th className="right">Số tiền</th><th className="right">Phân bổ cho học viên</th><th>Thời điểm</th><th>Nội dung</th></tr>
                  </thead>
                  <tbody>
                    {data.payments.map((row) => (
                      <tr key={row.id}>
                        <td>{row.direction === 'refund' ? 'Hoàn tiền' : 'Tiền vào'}</td>
                        <td data-label="Hình thức">{paymentMethodLabel(row.method)}</td>
                        <td data-label="Số tiền" className="right num">{fmtMoney(row.amountVnd, false)}</td>
                        <td data-label="Phân bổ cho học viên" className="right num">{fmtMoney(row.allocatedToContact, false)}</td>
                        <td data-label="Thời điểm">{fmtDateTime(row.receivedAt, true)}</td>
                        <td data-label="Nội dung">{row.memo ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="card">
            <div className="card-head"><h2>Chuyển khoản phải thu theo lớp mới</h2></div>
            {data.transfers.length === 0 && <Empty title="Chưa có ghi danh đã chuyển lớp" />}
            {data.transfers.length > 0 && (
              <div className="stack">
                {data.transfers.map((row) => (
                  <div className="card-body row-wrap" key={row.fromEnrollmentId}>
                    <div>
                      <div className="cell-title">{row.fromClassName} → {row.toClassName}</div>
                      <div className="cell-sub">{row.openChargeCount} khoản đang mở</div>
                    </div>
                    <span className="spacer" />
                    {writable && (
                      <button className="btn btn-sm" onClick={() => setMoving(row)}>Chuyển khoản phải thu</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
      {voiding && <VoidDialog charge={voiding} onClose={() => setVoiding(null)} />}
      {revoking && <RevokeDialog allocation={revoking} onClose={() => setRevoking(null)} />}
      {moving && <MoveDialog transfer={moving} onClose={() => setMoving(null)} />}
    </>
  );
}

function VoidDialog({ charge, onClose }: { charge: LedgerCharge; onClose: () => void }) {
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
      <p className="small muted">Chỉ hủy được khoản không còn phân bổ đang hiệu lực. Khoản đã hủy không nhận thêm tiền.</p>
      <Field label="Lý do" htmlFor="void-reason" required error={errors.reason}>
        <textarea id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required />
      </Field>
      <FormError error={m.error && !Object.keys(errors).length ? m.error : null} />
    </Modal>
  );
}

function RevokeDialog({ allocation, onClose }: { allocation: LedgerAllocation; onClose: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const m = useCommand<RevokeAllocationInput>('revokeAllocation');
  const errors = fieldErrors(m.error);
  const submit = () => m.mutate({ allocationId: allocation.id, version: allocation.version, reason: reason.trim() }, {
    onSuccess: () => { toast('Đã thu hồi phân bổ'); onClose(); },
  });
  return (
    <Modal open title={`Thu hồi phân bổ · ${allocation.chargeCode}`} onClose={onClose} footer={
      <button className="btn btn-danger" disabled={m.isPending || !reason.trim()} onClick={submit}>{m.isPending ? 'Đang lưu…' : 'Thu hồi phân bổ'}</button>
    }>
      <p className="small muted">Thu hồi {fmtMoney(allocation.amountVnd, false)} khỏi {allocation.chargeCode}. Dòng phân bổ được giữ, chỉ đánh dấu đã thu hồi.</p>
      <Field label="Lý do" htmlFor="revoke-reason" required error={errors.reason}>
        <textarea id="revoke-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required />
      </Field>
      <FormError error={m.error && !Object.keys(errors).length ? m.error : null} />
    </Modal>
  );
}

function MoveDialog({ transfer, onClose }: { transfer: LedgerTransfer; onClose: () => void }) {
  const toast = useToast();
  const m = useCommand<MoveEnrollmentChargesInput>('moveEnrollmentCharges');
  const submit = () => m.mutate({
    fromEnrollmentId: transfer.fromEnrollmentId, toEnrollmentId: transfer.toEnrollmentId, version: transfer.version,
  }, { onSuccess: () => { toast('Đã chuyển khoản phải thu'); onClose(); } });
  return (
    <Modal open title="Chuyển khoản phải thu theo lớp mới" onClose={onClose} footer={
      <button className="btn btn-primary" disabled={m.isPending} onClick={submit}>{m.isPending ? 'Đang lưu…' : 'Chuyển khoản'}</button>
    }>
      <p>Chuyển mọi khoản đang mở từ {transfer.fromClassName} sang {transfer.toClassName}. Hiện có {transfer.openChargeCount} khoản đang mở.</p>
      <FormError error={m.error} />
    </Modal>
  );
}
