import { useState } from 'react';
import { PRIVACY_REQUEST_KINDS, type AnonymizeContactInput, type ResolvePrivacyRequestInput } from '@abm/contracts';
import { useApi, useCommand } from '../api';
import { Empty, ErrorState, Field, FormError, Loading, Modal, useToast } from '../components/ui';
import { fmtDateTime } from '../format';

interface PrivacyRequest {
  id: string;
  contactId: string;
  contactName: string;
  contactVersion: number;
  kind: string;
  status: string;
  detail: string | null;
  resolution: string | null;
  version: number;
  createdAt: string;
}

const kindLabel = (code: string) => PRIVACY_REQUEST_KINDS.find((k) => k.code === code)?.label ?? code;
const statusLabel = (status: string) => (status === 'done' ? 'Xong' : status === 'rejected' ? 'Từ chối' : 'Đang mở');

export function PrivacyRequestsPage() {
  const list = useApi<PrivacyRequest[]>('/privacy');
  const rows = list.data ?? [];
  const [resolve, setResolve] = useState<{ request: PrivacyRequest; status: 'done' | 'rejected' } | null>(null);
  const [anonymize, setAnonymize] = useState<PrivacyRequest | null>(null);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dữ liệu cá nhân</h1>
          <p className="sub">Yêu cầu truy cập, sửa, rút đồng ý hoặc xóa hồ sơ. Chỉ Admin xử lý.</p>
        </div>
      </div>
      {list.isLoading && <Loading rows={4} />}
      {list.error && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
      {list.data && (
        <div className="card">
          {rows.length === 0 && <Empty title="Chưa có yêu cầu" />}
          {rows.length > 0 && (
            <div className="table-wrap">
              <table className="table responsive">
                <thead>
                  <tr><th>Khách</th><th>Loại</th><th>Trạng thái</th><th>Chi tiết</th><th>Ghi nhận</th><th /></tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.contactName}</td>
                      <td data-label="Loại">{kindLabel(row.kind)}</td>
                      <td data-label="Trạng thái">{statusLabel(row.status)}</td>
                      <td data-label="Chi tiết">{row.detail || row.resolution || '—'}</td>
                      <td data-label="Ghi nhận">{fmtDateTime(row.createdAt)}</td>
                      <td className="right">
                        {row.status === 'open' && (
                          <div className="row-wrap">
                            <button className="btn btn-sm" onClick={() => setResolve({ request: row, status: 'done' })}>Xong</button>
                            <button className="btn btn-sm" onClick={() => setResolve({ request: row, status: 'rejected' })}>Từ chối</button>
                            {row.kind === 'delete' && (
                              <button className="btn btn-sm" onClick={() => setAnonymize(row)}>Ẩn danh hồ sơ</button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {resolve && <ResolveDialog request={resolve.request} status={resolve.status} onClose={() => setResolve(null)} />}
      {anonymize && <AnonymizeDialog request={anonymize} onClose={() => setAnonymize(null)} />}
    </>
  );
}

function ResolveDialog({ request, status, onClose }: { request: PrivacyRequest; status: 'done' | 'rejected'; onClose: () => void }) {
  const toast = useToast();
  const [resolution, setResolution] = useState('');
  const m = useCommand<ResolvePrivacyRequestInput>('resolvePrivacyRequest');
  const title = status === 'done' ? 'Xong yêu cầu' : 'Từ chối yêu cầu';
  return (
    <Modal open title={title} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Hủy</button>
        <button className="btn btn-primary" disabled={m.isPending || !resolution.trim()}
          onClick={() => m.mutate(
            { requestId: request.id, version: request.version, status, resolution: resolution.trim() },
            { onSuccess: () => { toast(status === 'done' ? 'Đã xử lý yêu cầu' : 'Đã từ chối yêu cầu'); onClose(); } },
          )}>Lưu</button>
      </>
    }>
      <div className="stack">
        <p className="text-2">{request.contactName} · {kindLabel(request.kind)}</p>
        <Field label="Cách xử lý" htmlFor="privacy-resolution" required>
          <textarea id="privacy-resolution" value={resolution} onChange={(e) => setResolution(e.target.value)} maxLength={1000} required />
        </Field>
        <FormError error={m.error} />
      </div>
    </Modal>
  );
}

function AnonymizeDialog({ request, onClose }: { request: PrivacyRequest; onClose: () => void }) {
  const toast = useToast();
  const m = useCommand<AnonymizeContactInput>('anonymizeContact');
  return (
    <Modal open title="Ẩn danh hồ sơ" onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Hủy</button>
        <button className="btn btn-primary" disabled={m.isPending}
          onClick={() => m.mutate(
            { contactId: request.contactId, version: request.contactVersion, requestId: request.id },
            { onSuccess: () => { toast('Đã ẩn danh hồ sơ'); onClose(); } },
          )}>Ẩn danh hồ sơ</button>
      </>
    }>
      <div className="stack">
        <p className="text-2">Ẩn danh hồ sơ này? Tên và số điện thoại sẽ bị ẩn, chứng từ tiền vẫn giữ. Không hoàn tác được.</p>
        <FormError error={m.error} />
      </div>
    </Modal>
  );
}
