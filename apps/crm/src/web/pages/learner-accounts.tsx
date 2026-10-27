import { useState } from 'react';
import {
  PASSWORD_MIN_LENGTH,
  type GrantProgramAccessInput,
  type ResetLearnerPasswordInput,
  type RevokeProgramAccessInput,
  type SetLearnerAccountStatusInput,
  type SetLearnerDefaultPasswordInput,
} from '@abm/contracts';
import { useActor } from '../actor-context';
import { useApi, useCommand } from '../api';
import {
  Alert,
  Badge,
  ConfirmDialog,
  Empty,
  ErrorState,
  Field,
  FormError,
  Loading,
  Modal,
  SegmentedControl,
  fieldErrors,
  useDebounced,
  useToast,
} from '../components/ui';
import { fmtDateTime } from '../format';
import type { LearnerAccountRow, LearnerAccountSettings, LmsProgramOption } from '../types';

const vnTime = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function fmtLockedTime(iso: string) {
  return vnTime.format(new Date(iso));
}

export function LearnerAccountsPage() {
  const actor = useActor();
  const toast = useToast();
  const canRead = actor.role === 'academic' || actor.role === 'admin' || actor.role === 'director';
  const canWrite = actor.role === 'academic' || actor.role === 'admin';
  const isAdmin = actor.role === 'admin';

  const [q, setQ] = useState('');
  const debouncedQ = useDebounced(q, 250);
  const [classId, setClassId] = useState('');
  const [passwordState, setPasswordState] = useState<'' | 'default' | 'changed'>('');
  const [accessTarget, setAccessTarget] = useState<LearnerAccountRow | null>(null);
  const [resetTarget, setResetTarget] = useState<LearnerAccountRow | null>(null);

  const settings = useApi<LearnerAccountSettings>(canRead ? '/lms/settings' : null);
  const programs = useApi<LmsProgramOption[]>(canRead ? '/lms/programs' : null);

  const params = new URLSearchParams();
  if (debouncedQ.trim()) params.set('q', debouncedQ.trim());
  if (classId) params.set('classId', classId);
  if (passwordState) params.set('passwordState', passwordState);
  const queryStr = params.toString();
  const accounts = useApi<LearnerAccountRow[]>(
    canRead ? `/lms/accounts${queryStr ? `?${queryStr}` : ''}` : null,
  );

  const resetPwCmd = useCommand<ResetLearnerPasswordInput>('resetLearnerPassword');
  const statusCmd = useCommand<SetLearnerAccountStatusInput>('setLearnerAccountStatus');
  const revokeCmd = useCommand<RevokeProgramAccessInput>('revokeProgramAccess');

  if (!canRead) {
    return <Alert tone="warn">Bạn không có quyền xem trang này.</Alert>;
  }

  const nowIso = new Date().toISOString();
  const classOptions = (programs.data ?? []).filter((p) => p.classId);

  const handleResetPassword = (acc: LearnerAccountRow) => {
    resetPwCmd.mutate(
      { accountId: acc.id, version: acc.version },
      {
        onSuccess: () => {
          toast('Đã đặt lại mật khẩu về mặc định');
          setResetTarget(null);
          void accounts.refetch();
        },
        onError: () => setResetTarget(null),
      },
    );
  };

  const handleToggleStatus = (acc: LearnerAccountRow) => {
    const nextStatus = acc.status === 'active' ? 'disabled' : 'active';
    statusCmd.mutate(
      { accountId: acc.id, version: acc.version, status: nextStatus },
      {
        onSuccess: () => {
          toast(nextStatus === 'disabled' ? 'Đã khoá tài khoản' : 'Đã mở khoá tài khoản');
          void accounts.refetch();
        },
      },
    );
  };

  const handleRevokeAccess = (accessId: string, accessVersion: number) => {
    revokeCmd.mutate(
      { accessId, version: accessVersion },
      {
        onSuccess: () => {
          toast('Đã thu hồi quyền chương trình');
          void accounts.refetch();
        },
      },
    );
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tài khoản học viên</h1>
          <p className="sub">Quản lý tài khoản đăng nhập cổng học LMS, mật khẩu mặc định và quyền truy cập chương trình.</p>
        </div>
      </div>

      <div className="stack">
        {isAdmin && (
          <DefaultPasswordCard
            hasDefaultPassword={settings.data?.hasDefaultPassword ?? false}
            loading={settings.isLoading}
            onSaved={() => void settings.refetch()}
          />
        )}

        <section className="card">
          <div className="card-head" style={{ flexWrap: 'wrap' }}>
            <h2>Danh sách tài khoản</h2>
            <span className="spacer" />
            {accounts.data && <Badge>{accounts.data.length}</Badge>}
          </div>

          <div className="card-body stack">
            <div className="row-wrap">
              <input
                type="search"
                aria-label="Tìm theo tên hoặc email"
                placeholder="Tìm tên hoặc email học viên…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                style={{ maxWidth: 280 }}
              />
              <select
                aria-label="Lọc theo chương trình"
                value={classId}
                onChange={(e) => setClassId(e.target.value)}
                style={{ maxWidth: 280 }}
              >
                <option value="">Tất cả chương trình</option>
                {classOptions.map((p) => (
                  <option key={p.programId} value={p.classId!}>
                    {p.className ? `${p.className} — ` : ''}{p.title}
                  </option>
                ))}
              </select>
              <select
                aria-label="Trạng thái mật khẩu"
                value={passwordState}
                onChange={(e) => setPasswordState(e.target.value as '' | 'default' | 'changed')}
                style={{ maxWidth: 240 }}
              >
                <option value="">Mọi trạng thái mật khẩu</option>
                <option value="default">Còn mật khẩu mặc định</option>
                <option value="changed">Đã đổi mật khẩu</option>
              </select>
            </div>

            <FormError error={resetPwCmd.error ?? statusCmd.error ?? revokeCmd.error} />

            {accounts.isLoading ? (
              <Loading rows={5} />
            ) : accounts.error ? (
              <ErrorState error={accounts.error} onRetry={() => accounts.refetch()} />
            ) : !accounts.data || accounts.data.length === 0 ? (
              <Empty title="Không có tài khoản học viên phù hợp" />
            ) : (
              <div className="table-wrap">
                <table className="table responsive">
                  <thead>
                    <tr>
                      <th>Học viên</th>
                      <th>Chương trình</th>
                      <th>Mật khẩu</th>
                      <th>Trạng thái</th>
                      <th>Đăng nhập gần nhất</th>
                      {canWrite && <th className="right"><span className="visually-hidden">Thao tác</span></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.data.map((acc) => {
                      const isLocked = Boolean(acc.lockedUntil && acc.lockedUntil > nowIso);
                      return (
                        <tr key={acc.id}>
                          <td>
                            <div className="cell-title">{acc.displayName}</div>
                            <div className="cell-sub">{acc.email}</div>
                          </td>
                          <td data-label="Chương trình">
                            {acc.programs.length === 0 ? (
                              <span className="small muted">—</span>
                            ) : (
                              <div className="stack-sm">
                                {acc.programs.map((p, idx) => (
                                  <div key={`${p.programId}-${p.accessId ?? idx}`} className="row-wrap">
                                    <span>
                                      {p.title}
                                      {p.className ? <span className="small muted"> ({p.className})</span> : null}
                                    </span>
                                    {p.via === 'grant' && p.mode === 'grant' && (
                                      <Badge tone="agent">cấp tay</Badge>
                                    )}
                                    {p.via === 'grant' && p.mode === 'block' && (
                                      <Badge tone="danger">chặn</Badge>
                                    )}
                                    {canWrite && p.via === 'grant' && p.accessId && p.accessVersion !== undefined && (
                                      <button
                                        type="button"
                                        className="btn btn-sm btn-ghost"
                                        disabled={revokeCmd.isPending}
                                        onClick={() => handleRevokeAccess(p.accessId!, p.accessVersion!)}
                                      >
                                        Thu hồi
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                          <td data-label="Mật khẩu">
                            {acc.usesDefaultPassword ? (
                              <Badge tone="warn">Mặc định</Badge>
                            ) : (
                              <Badge tone="ok">Đã đổi</Badge>
                            )}
                          </td>
                          <td data-label="Trạng thái">
                            {acc.status === 'disabled' ? (
                              <Badge tone="danger">Đã khoá</Badge>
                            ) : isLocked ? (
                              <Badge tone="warn">Tạm khoá đến {fmtLockedTime(acc.lockedUntil!)}</Badge>
                            ) : (
                              <Badge tone="ok">Hoạt động</Badge>
                            )}
                          </td>
                          <td data-label="Đăng nhập gần nhất" className="nowrap">
                            {fmtDateTime(acc.lastLoginAt)}
                          </td>
                          {canWrite && (
                            <td className="right">
                              <div className="row-wrap" style={{ justifyContent: 'flex-end' }}>
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  disabled={resetPwCmd.isPending}
                                  onClick={() => setResetTarget(acc)}
                                >
                                  Đặt lại MK
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  disabled={statusCmd.isPending}
                                  onClick={() => handleToggleStatus(acc)}
                                >
                                  {acc.status === 'active' ? 'Khoá' : 'Mở khoá'}
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  onClick={() => setAccessTarget(acc)}
                                >
                                  Cấp/chặn chương trình
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>

      {accessTarget && canWrite && (
        <GrantProgramAccessModal
          account={accessTarget}
          programs={programs.data ?? []}
          onClose={() => setAccessTarget(null)}
          onSaved={() => {
            setAccessTarget(null);
            void accounts.refetch();
          }}
        />
      )}

      {resetTarget && canWrite && (
        <ConfirmDialog
          open
          title="Đặt lại mật khẩu?"
          confirmLabel="Đặt lại mật khẩu"
          tone="primary"
          pending={resetPwCmd.isPending}
          onConfirm={() => handleResetPassword(resetTarget)}
          onCancel={() => setResetTarget(null)}
        >
          Đưa tài khoản của <strong>{resetTarget.displayName}</strong> về mật khẩu mặc định? Học viên sẽ đăng nhập
          bằng mật khẩu mặc định cho tới khi tự đổi.
        </ConfirmDialog>
      )}
    </>
  );
}

function DefaultPasswordCard({
  hasDefaultPassword,
  loading,
  onSaved,
}: {
  hasDefaultPassword: boolean;
  loading: boolean;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const saveCmd = useCommand<SetLearnerDefaultPasswordInput>('setLearnerDefaultPassword');
  const errors = fieldErrors(saveCmd.error);

  const submit = () => {
    if (password.length < PASSWORD_MIN_LENGTH) {
      setLocalError(`Mật khẩu cần tối thiểu ${PASSWORD_MIN_LENGTH} ký tự`);
      return;
    }
    if (password !== repeat) {
      setLocalError('Hai ô mật khẩu chưa khớp');
      return;
    }
    setLocalError(null);
    saveCmd.mutate(
      { password },
      {
        onSuccess: () => {
          setPassword('');
          setRepeat('');
          toast('Đã lưu mật khẩu mặc định của học viên');
          onSaved();
        },
      },
    );
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Mật khẩu mặc định của học viên</h2>
        <span className="spacer" />
        {!loading && (
          <Badge tone={hasDefaultPassword ? 'ok' : 'warn'}>
            {hasDefaultPassword ? 'Đã đặt' : 'Chưa đặt'}
          </Badge>
        )}
      </div>
      <form
        className="card-body stack"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p className="small muted">
          Đổi mật khẩu mặc định sẽ áp dụng cho mọi học viên chưa tự đổi mật khẩu.
        </p>
        {localError && <Alert tone="danger">{localError}</Alert>}
        <FormError error={saveCmd.error && !Object.keys(errors).length ? saveCmd.error : null} />
        <div className="grid-2">
          <Field
            label="Mật khẩu mặc định mới"
            required
            error={errors.password}
            hint={`Tối thiểu ${PASSWORD_MIN_LENGTH} ký tự`}
            htmlFor="lms-def-pw"
          >
            <input
              id="lms-def-pw"
              type="password"
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={128}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setLocalError(null); }}
              required
            />
          </Field>
          <Field label="Nhập lại mật khẩu mặc định" required htmlFor="lms-def-pw-repeat">
            <input
              id="lms-def-pw-repeat"
              type="password"
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={128}
              value={repeat}
              onChange={(e) => { setRepeat(e.target.value); setLocalError(null); }}
              required
            />
          </Field>
        </div>
        <div className="row-wrap">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!password || !repeat || saveCmd.isPending}
          >
            {saveCmd.isPending ? 'Đang lưu…' : 'Lưu mật khẩu mặc định'}
          </button>
        </div>
      </form>
    </section>
  );
}

function GrantProgramAccessModal({
  account,
  programs,
  onClose,
  onSaved,
}: {
  account: LearnerAccountRow;
  programs: LmsProgramOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [programId, setProgramId] = useState(programs[0]?.programId ?? '');
  const [mode, setMode] = useState<'grant' | 'block'>('grant');
  const [expiryDate, setExpiryDate] = useState('');
  const [note, setNote] = useState('');
  const grantCmd = useCommand<GrantProgramAccessInput>('grantProgramAccess');
  const errors = fieldErrors(grantCmd.error);

  const submit = () => {
    if (!programId) return;
    const expiresAt = expiryDate ? new Date(`${expiryDate}T23:59:59+07:00`).toISOString() : undefined;
    grantCmd.mutate(
      {
        contactId: account.contactId,
        programId,
        mode,
        ...(expiresAt ? { expiresAt } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      {
        onSuccess: () => {
          toast(mode === 'grant' ? 'Đã cấp quyền chương trình' : 'Đã chặn quyền chương trình');
          onSaved();
        },
      },
    );
  };

  return (
    <Modal
      open
      title={`Cấp/chặn chương trình — ${account.displayName}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!programId || grantCmd.isPending}
            onClick={submit}
          >
            {grantCmd.isPending ? 'Đang lưu…' : 'Xác nhận'}
          </button>
        </>
      }
    >
      <FormError error={grantCmd.error} />
      <Field label="Chương trình" required error={errors.programId} htmlFor="lms-grant-prog">
        <select
          id="lms-grant-prog"
          value={programId}
          onChange={(e) => setProgramId(e.target.value)}
          required
        >
          <option value="">Chọn chương trình…</option>
          {programs.map((p) => (
            <option key={p.programId} value={p.programId}>
              {p.title}{p.className ? ` (${p.className})` : ''}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Hình thức">
        <SegmentedControl
          value={mode}
          onChange={setMode}
          ariaLabel="Hình thức cấp hoặc chặn"
          options={[
            { value: 'grant', label: 'Cấp quyền xem' },
            { value: 'block', label: 'Chặn quyền xem' },
          ]}
        />
      </Field>
      <Field
        label="Ngày hết hạn (tuỳ chọn)"
        error={errors.expiresAt}
        hint="Để trống = không giới hạn thời gian"
        htmlFor="lms-grant-exp"
      >
        <input
          id="lms-grant-exp"
          type="date"
          value={expiryDate}
          onChange={(e) => setExpiryDate(e.target.value)}
        />
      </Field>
      <Field label="Ghi chú" error={errors.note} htmlFor="lms-grant-note">
        <textarea
          id="lms-grant-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="Lý do cấp tay hoặc chặn quyền…"
        />
      </Field>
    </Modal>
  );
}
