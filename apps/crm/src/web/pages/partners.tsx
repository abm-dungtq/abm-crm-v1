import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { PARTNER_CONTRACT_STATUSES, type PartnerContractStatus, type UpsertPartnerContractInput } from '@abm/contracts';
import { useActor } from '../actor-context';
import { useApi, useCommand } from '../api';
import { Badge, Empty, ErrorState, Field, FormError, Loading, Modal, fieldErrors, useToast } from '../components/ui';
import { fmtDate } from '../format';
import type { PartnerDetail, PartnerRow } from '../types';
import { canWriteLearners } from './learners';

export const contractStatusLabel = (code: string) => PARTNER_CONTRACT_STATUSES.find((s) => s.code === code)?.label ?? code;
export const contractTone = (code: string) => (code === 'active' ? 'ok' : code === 'cancelled' ? 'danger' : code === 'done' ? 'info' : 'neutral');

export function PartnersPage() {
  const actor = useActor();
  const list = useApi<PartnerRow[]>('/partners');
  const [creating, setCreating] = useState(false);
  const rows = list.data ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Đối tác</h1>
          <p className="sub">Hợp đồng với trường, doanh nghiệp, đơn vị giới thiệu học viên. Chỉ hợp đồng đang hiệu lực mới nhận học viên mới.</p>
        </div>
        {canWriteLearners(actor.role) && <button className="btn btn-primary" onClick={() => setCreating(true)}>Tạo hợp đồng</button>}
      </div>
      <div className="card">
        {list.isLoading && <div className="card-body"><Loading /></div>}
        {list.error && <div className="card-body"><ErrorState error={list.error} onRetry={() => list.refetch()} /></div>}
        {list.data && rows.length === 0 && <Empty title="Chưa có hợp đồng đối tác">Tạo hợp đồng để nhập danh sách học viên từ đối tác.</Empty>}
        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr><th>Hợp đồng</th><th>Đối tác</th><th>Trạng thái</th><th>Thời hạn</th><th className="right">Học viên</th><th className="right">Bước</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><Link to="/partners/$id" params={{ id: r.id }} className="cell-title">{r.name}</Link></td>
                    <td data-label="Đối tác">{r.accountName}</td>
                    <td data-label="Trạng thái"><Badge tone={contractTone(r.status)} dot>{contractStatusLabel(r.status)}</Badge></td>
                    <td data-label="Thời hạn" className="nowrap">{r.startsOn || r.endsOn ? `${r.startsOn ?? '…'} → ${r.endsOn ?? '…'}` : '—'}</td>
                    <td data-label="Học viên" className="right num">{r.learnerCount}</td>
                    <td data-label="Bước" className="right num">{r.stepsDone}/{r.stepsTotal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {creating && <ContractDialog existingAccounts={uniqueAccounts(rows)} onClose={() => setCreating(false)} />}
    </>
  );
}

const uniqueAccounts = (rows: PartnerRow[]) => [...new Map(rows.map((r) => [r.accountId, r.accountName])).entries()].map(([id, name]) => ({ id, name }));

/** Create a contract, or edit `contract` when given. A new partner is created from its name. */
export function ContractDialog({ contract, existingAccounts, onClose }: {
  contract?: PartnerDetail['contract']; existingAccounts: { id: string; name: string }[]; onClose: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    accountId: contract?.accountId ?? '', accountName: '', name: contract?.name ?? '', status: (contract?.status ?? 'draft') as PartnerContractStatus,
    startsOn: contract?.startsOn ?? '', endsOn: contract?.endsOn ?? '', note: contract?.note ?? '',
  });
  const m = useCommand<UpsertPartnerContractInput>('upsertPartnerContract');
  const errors = fieldErrors(m.error);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const opt = (v: string) => v.trim() || undefined;
  const newPartner = form.accountId === '';

  const submit = () => m.mutate({
    id: contract?.id, version: contract?.version,
    accountId: opt(form.accountId), accountName: newPartner ? opt(form.accountName) : undefined,
    name: form.name, status: form.status, startsOn: opt(form.startsOn), endsOn: opt(form.endsOn), note: opt(form.note),
  }, { onSuccess: () => { toast(contract ? 'Đã lưu hợp đồng' : 'Đã tạo hợp đồng'); onClose(); } });

  return (
    <Modal open title={contract ? 'Sửa hợp đồng' : 'Tạo hợp đồng đối tác'} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Hủy</button>
        <button className="btn btn-primary" form="contract-form" disabled={m.isPending}>{m.isPending ? 'Đang lưu…' : 'Lưu'}</button>
      </>
    }>
      <form id="contract-form" className="stack" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label="Đối tác" htmlFor="ct-account" required error={errors.accountName ?? errors.accountId}>
          <select id="ct-account" value={form.accountId} onChange={set('accountId')}>
            <option value="">{contract ? 'Giữ nguyên đối tác' : 'Đối tác mới…'}</option>
            {existingAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        {newPartner && (
          <Field label={contract ? 'Hoặc đổi sang đối tác mới' : 'Tên đối tác mới'} htmlFor="ct-account-name" required={!contract}>
            <input id="ct-account-name" type="text" value={form.accountName} onChange={set('accountName')} required={!contract} maxLength={200} autoComplete="off" />
          </Field>
        )}
        <Field label="Tên hợp đồng" htmlFor="ct-name" required error={errors.name}>
          <input id="ct-name" type="text" value={form.name} onChange={set('name')} required maxLength={200} autoComplete="off" />
        </Field>
        <div className="grid-2">
          <Field label="Trạng thái" htmlFor="ct-status">
            <select id="ct-status" value={form.status} onChange={set('status')}>
              {PARTNER_CONTRACT_STATUSES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
            </select>
          </Field>
          <span />
          <Field label="Bắt đầu" htmlFor="ct-start" error={errors.startsOn}><input id="ct-start" type="date" value={form.startsOn} onChange={set('startsOn')} /></Field>
          <Field label="Kết thúc" htmlFor="ct-end" error={errors.endsOn}><input id="ct-end" type="date" value={form.endsOn} onChange={set('endsOn')} /></Field>
        </div>
        <Field label="Ghi chú" htmlFor="ct-note"><textarea id="ct-note" value={form.note} onChange={set('note')} maxLength={1000} /></Field>
        <FormError error={m.error && !Object.keys(errors).length ? m.error : null} />
      </form>
    </Modal>
  );
}
