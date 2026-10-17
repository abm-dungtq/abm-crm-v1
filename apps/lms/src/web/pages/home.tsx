import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { api, useApi, type LearnerMe, type ProgramSummary } from '../api';

export function Header({ me }: { me: LearnerMe }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const logout = useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSettled: () => {
      client.clear();
      void navigate({ to: '/dang-nhap' });
    },
  });

  return (
    <header className="lp-head">
      <Link to="/" className="lp-logo">
        ABM · Học tập
      </Link>
      <div className="lp-user">
        <span>{me.displayName}</span>
        <span>·</span>
        <Link to="/doi-mat-khau" className="note">
          Đổi mật khẩu
        </Link>
        <span>·</span>
        <button
          type="button"
          className="btn sm"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
        >
          Đăng xuất
        </button>
      </div>
    </header>
  );
}

export function HomePage({ me }: { me: LearnerMe }) {
  const navigate = useNavigate();
  const programs = useApi<ProgramSummary[]>('/programs');

  return (
    <div>
      <Header me={me} />
      {me.usesDefaultPassword && (
        <div className="banner">
          <span>
            Anh/Chị đang dùng mật khẩu mặc định. Nên đổi mật khẩu để bảo vệ tài khoản.
          </span>
          <button
            type="button"
            className="btn sm"
            onClick={() => void navigate({ to: '/doi-mat-khau' })}
          >
            Đổi mật khẩu
          </button>
        </div>
      )}
      {programs.isLoading ? (
        <div className="empty-state">Đang tải danh sách chương trình…</div>
      ) : programs.error ? (
        <div className="empty-state">
          <div className="alert-danger" style={{ display: 'inline-block' }}>
            {programs.error.message}
          </div>
        </div>
      ) : !programs.data || programs.data.length === 0 ? (
        <div className="empty-state">Anh/Chị chưa được ghi danh chương trình nào.</div>
      ) : (
        <div className="prog">
          {programs.data.map((p) => {
            const isExpired = p.state === 'expired';
            const pct =
              p.lessonCount > 0 ? Math.round((p.completedCount / p.lessonCount) * 100) : 0;
            const openProgram = () => {
              if (isExpired) return;
              void navigate({
                to: '/hoc/$programId',
                params: { programId: p.id },
                search: { phan: p.nextSectionId ?? undefined },
              });
            };
            return (
              <div
                key={p.id}
                className={`pcard${isExpired ? ' expired' : ''}`}
                role={isExpired ? undefined : 'button'}
                tabIndex={isExpired ? -1 : 0}
                onClick={openProgram}
                onKeyDown={(e) => {
                  if (!isExpired && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    openProgram();
                  }
                }}
              >
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {p.className && <span className="pill p-info">{p.className}</span>}
                  {isExpired && <span className="pill p-bad">Đã hết hạn xem lại</span>}
                </div>
                <h3 style={{ margin: '8px 0 4px', fontSize: 16 }}>{p.title}</h3>
                <div className="bar-p">
                  <b style={{ width: `${pct}%` }} />
                </div>
                <div className="note">
                  Đã học {p.completedCount}/{p.lessonCount} phần
                  {!isExpired && p.nextSectionId ? ` · Tiếp tục: ${p.nextSectionId}` : ''}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
