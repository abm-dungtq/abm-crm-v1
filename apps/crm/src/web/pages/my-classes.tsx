import { Link } from '@tanstack/react-router';
import { useActor } from '../actor-context';
import { useApi } from '../api';
import { Empty, ErrorState, Loading } from '../components/ui';
import { fmtDateTime } from '../format';

interface SessionRow { id: string; startsAt: string; durationMinutes: number; kind: string; status: string; note: string | null }
interface ClassRow {
  id: string; name: string; courseName: string; scheduleText: string | null; status: string; assigned: boolean;
  upcoming: SessionRow[]; past: SessionRow[];
}

const kindLabel = (kind: string) => kind === 'trial' ? 'Học thử' : kind === 'makeup' ? 'Học bù' : 'Buổi học';

export function MyClassesPage() {
  const actor = useActor();
  const q = useApi<{ classes: ClassRow[] }>('/my-classes');
  if (q.isLoading) return <Loading rows={6} />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const classes = q.data.classes;
  const split = actor.role === 'admin' || actor.role === 'academic';
  const mine = classes.filter((klass) => klass.assigned);
  const others = classes.filter((klass) => !klass.assigned);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Lớp của tôi</h1>
          <p className="sub">Điểm danh từng buổi. Chỉ hiện tên học viên.</p>
        </div>
      </div>
      {classes.length === 0 ? <Empty title="Chưa có lớp" /> : split ? (
        <div className="stack">
          <section className="stack">
            <h2>Lớp tôi dạy</h2>
            {mine.length === 0 ? <Empty title="Chưa được gán lớp nào" /> : <div className="grid">{mine.map((klass) => <ClassCard key={klass.id} klass={klass} />)}</div>}
          </section>
          {others.length > 0 && (
            <details className="card">
              <summary className="card-head">Lớp khác ({others.length})</summary>
              <div className="grid card-body">{others.map((klass) => <ClassCard key={klass.id} klass={klass} />)}</div>
            </details>
          )}
        </div>
      ) : (
        <div className="grid">{classes.map((klass) => <ClassCard key={klass.id} klass={klass} />)}</div>
      )}
    </>
  );
}

function ClassCard({ klass }: { klass: ClassRow }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>{klass.name}</h2>
        <span className="spacer" />
        <span className="small muted">{klass.courseName}{klass.scheduleText ? ` · ${klass.scheduleText}` : ''}</span>
      </div>
      <SessionList title="Sắp tới" sessions={klass.upcoming} />
      <SessionList title="Đã qua" sessions={klass.past} />
    </section>
  );
}

function SessionList({ title, sessions }: { title: string; sessions: SessionRow[] }) {
  return (
    <div className="card-body stack-sm">
      <h3 className="small muted">{title}</h3>
      {sessions.length === 0 ? <p className="small muted">Không có buổi.</p> : (
        <ul className="list">
          {sessions.map((s) => (
            <li key={s.id} className="row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div>{kindLabel(s.kind)} · {fmtDateTime(s.startsAt)} · {s.durationMinutes} phút</div>
                <div className="small muted">{s.status === 'cancelled' ? 'Đã hủy' : 'Đã xếp lịch'}{s.note ? ` · ${s.note}` : ''}</div>
              </div>
              <Link to="/sessions/$sessionId" params={{ sessionId: s.id }} className="btn btn-sm">Điểm danh</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
