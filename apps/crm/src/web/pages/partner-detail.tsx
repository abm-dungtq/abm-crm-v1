import { useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import type { AddContractStepInput, ImportContractLearnersInput, ToggleContractStepInput } from '@abm/contracts';
import { useActor } from '../actor-context';
import { ApiFailure, useApi, useCommand } from '../api';
import { Alert, Badge, Empty, ErrorState, Field, FormError, Loading, useToast } from '../components/ui';
import type { ImportPreview, PartnerDetail } from '../types';
import { canWriteLearners, useOwnerOptions } from './learners';
import { ContractDialog, contractStatusLabel, contractTone } from './partners';

const CSV_HEADER = 'Họ tên,Số điện thoại,Email,Nhu cầu';

export function PartnerDetailPage() {
  const { id } = useParams({ from: '/partners/$id' });
  const q = useApi<PartnerDetail>(`/partners/${id}`);
  if (q.isLoading) return <Loading rows={6} />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return <PartnerView detail={q.data} />;
}

function PartnerView({ detail }: { detail: PartnerDetail }) {
  const actor = useActor();
  const toast = useToast();
  const { contract, steps, learners } = detail;
  const canWrite = canWriteLearners(actor.role);
  const [editing, setEditing] = useState(false);
  const [stepName, setStepName] = useState('');
  const addStep = useCommand<AddContractStepInput>('addContractStep');
  const toggle = useCommand<ToggleContractStepInput>('toggleContractStep');

  return (
    <>
      <div className="page-head" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div className="small"><Link to="/partners">Đối tác</Link> / {contract.accountName}</div>
          <h1 className="truncate">{contract.name}</h1>
          <div className="row-wrap" style={{ marginTop: 6 }}>
            <Badge tone={contractTone(contract.status)} dot>{contractStatusLabel(contract.status)}</Badge>
            <span className="small muted">{contract.startsOn || contract.endsOn ? `${contract.startsOn ?? '…'} → ${contract.endsOn ?? '…'}` : 'Chưa đặt thời hạn'}</span>
          </div>
          {contract.note && <p className="text-2" style={{ marginTop: 6 }}>{contract.note}</p>}
        </div>
        {canWrite && <button className="btn" onClick={() => setEditing(true)}>Sửa hợp đồng</button>}
      </div>

      <div className="cols-main">
        <div className="grid">
          <section className="card" aria-labelledby="pc-learners">
            <div className="card-head"><h2 id="pc-learners">Học viên của hợp đồng</h2><span className="spacer" /><span className="small muted">{learners.length}</span></div>
            {learners.length === 0 ? <Empty title="Chưa có học viên">Nhập danh sách CSV hoặc tạo lead với nguồn Đối tác.</Empty> : (
              <div className="table-wrap">
                <table className="table responsive">
                  <thead><tr><th>Học viên</th><th>Điện thoại</th><th>Sale</th><th>Trạng thái</th></tr></thead>
                  <tbody>
                    {learners.map((l) => (
                      <tr key={l.leadId}>
                        <td><Link to="/learners/$contactId" params={{ contactId: l.contactId }} className="cell-title">{l.name}</Link><div className="cell-sub mono">{l.code}</div></td>
                        <td data-label="Điện thoại" className="nowrap">{l.phone ?? <span className="muted">Ẩn</span>}</td>
                        <td data-label="Sale">{l.ownerName ?? <span className="muted">Sale khác</span>}</td>
                        <td data-label="Trạng thái">{l.stageLabel}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          {canWrite && contract.status === 'active' && <ImportCard contractId={contract.id} />}
          {canWrite && contract.status !== 'active' && <Alert tone="info">Chỉ hợp đồng đang hiệu lực mới nhập được danh sách học viên.</Alert>}
        </div>

        <div className="grid">
          <section className="card" aria-labelledby="pc-steps">
            <div className="card-head"><h2 id="pc-steps">Các bước của hợp đồng</h2></div>
            {steps.length === 0 ? <Empty title="Chưa có bước nào">Thêm bước như Ký hợp đồng, Gửi danh sách, Thanh toán.</Empty> : (
              <ul className="list">
                {steps.map((s) => (
                  <li key={s.id} className="row">
                    <label className="row" style={{ flex: 1, minWidth: 0 }}>
                      <input type="checkbox" checked={s.doneAt !== null} disabled={!canWrite || toggle.isPending}
                        onChange={(e) => toggle.mutate({ stepId: s.id, version: s.version, done: e.target.checked })} />
                      <span style={s.doneAt ? { textDecoration: 'line-through', color: 'var(--muted)' } : undefined}>{s.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {canWrite && (
              <form className="card-body stack-sm" style={{ borderTop: '1px solid var(--border)' }} onSubmit={(e) => {
                e.preventDefault();
                addStep.mutate({ contractId: contract.id, name: stepName }, { onSuccess: () => { setStepName(''); toast('Đã thêm bước'); } });
              }}>
                <div className="row">
                  <label className="visually-hidden" htmlFor="pc-step-name">Tên bước mới</label>
                  <input id="pc-step-name" type="text" value={stepName} onChange={(e) => setStepName(e.target.value)} placeholder="Tên bước mới" maxLength={200} style={{ flex: 1 }} />
                  <button className="btn btn-primary" disabled={!stepName.trim() || addStep.isPending}>Thêm</button>
                </div>
                <FormError error={addStep.error ?? toggle.error} />
              </form>
            )}
          </section>
        </div>
      </div>
      {editing && <ContractDialog contract={contract} existingAccounts={[{ id: contract.accountId, name: contract.accountName }]} onClose={() => setEditing(false)} />}
    </>
  );
}

/** Pick a CSV, preview what would be created, then confirm. The commit runs as one transaction. */
function ImportCard({ contractId }: { contractId: string }) {
  const actor = useActor();
  const toast = useToast();
  const owners = useOwnerOptions();
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [ownerUserId, setOwner] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const previewCmd = useCommand<ImportContractLearnersInput, ImportPreview>('importContractLearners');
  const commitCmd = useCommand<ImportContractLearnersInput, ImportPreview>('importContractLearners');
  const body = (commit: boolean): ImportContractLearnersInput => ({
    contractId, csv, commit, ownerUserId: actor.role === 'admin' ? ownerUserId || undefined : undefined,
  });
  const failure = previewCmd.error ?? commitCmd.error;
  const needsOwner = actor.role === 'admin' && !ownerUserId;

  const readFile = async (file: File | undefined) => {
    setPreview(null);
    if (!file) return;
    setFileName(file.name);
    setCsv(await file.text());
  };

  return (
    <section className="card" aria-labelledby="pc-import">
      <div className="card-head"><h2 id="pc-import">Nhập học viên từ CSV</h2></div>
      <div className="card-body stack">
        <p className="text-2">Cột bắt buộc: <span className="mono">{CSV_HEADER}</span>. Mỗi dòng cần số điện thoại hoặc email. Khách đang do sale khác giữ hoặc đang ở hồ chung sẽ bị báo lỗi ở dòng đó.</p>
        <Field label="File CSV" htmlFor="pc-csv" hint={fileName || 'Tối đa 200 dòng, 500 KB'}>
          <input id="pc-csv" type="file" accept=".csv,text/csv" onChange={(e) => void readFile(e.target.files?.[0])} />
        </Field>
        {actor.role === 'admin' && (
          <Field label="Sale phụ trách" required htmlFor="pc-owner">
            <select id="pc-owner" value={ownerUserId} onChange={(e) => { setOwner(e.target.value); setPreview(null); }}>
              <option value="">Chọn sale</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>
        )}
        <div className="row-wrap">
          <button className="btn" disabled={!csv || needsOwner || previewCmd.isPending}
            onClick={() => previewCmd.mutate(body(false), { onSuccess: setPreview })}>{previewCmd.isPending ? 'Đang kiểm tra…' : 'Xem trước'}</button>
        </div>
        {failure instanceof ApiFailure ? <FormError error={failure} /> : null}
        {preview && (
          <div className="stack-sm">
            <Alert tone={preview.errors.length ? 'warn' : 'ok'}>
              {preview.create.length} học viên sẽ được tạo, {preview.errors.length} lỗi{preview.errors.length ? ' (các dòng lỗi sẽ bị bỏ qua)' : ''}.
            </Alert>
            {preview.errors.length > 0 && (
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                {preview.errors.map((e, i) => <li key={i}>{e.line ? `Dòng ${e.line}: ` : ''}{e.message}</li>)}
              </ul>
            )}
            <div className="row-wrap">
              <button className="btn btn-primary" disabled={preview.create.length === 0 || commitCmd.isPending}
                onClick={() => commitCmd.mutate(body(true), {
                  onSuccess: (r) => { toast(`Đã tạo ${r.create.length} học viên`); setPreview(null); setCsv(''); setFileName(''); },
                })}>{commitCmd.isPending ? 'Đang nhập…' : `Xác nhận nhập ${preview.create.length} học viên`}</button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
