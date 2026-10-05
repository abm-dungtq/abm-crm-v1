import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { UpsertClassInput, UpsertCourseInput } from '@abm/contracts';
import { useApi, useCommand } from '../api';
import { Badge, Empty, ErrorState, Field, FormError, Loading, fieldErrors, useToast } from '../components/ui';
import { fmtDate } from '../format';
import type { ProductItem } from '../types';

interface ManageClass {
  id: string; name: string; scheduleText: string | null; note: string | null; status: string; version: number;
  studentCount: number; sessionCount: number;
}
interface ManageCourse {
  id: string; name: string; status: string; version: number; productId: string; productName: string; classes: ManageClass[];
}
interface Overdue {
  id: string; deferredUntil: string; contactId: string; contactName: string; classId: string; className: string; courseName: string;
}
type CoursePayload = { scope: 'manage'; courses: ManageCourse[] } | { scope: 'open'; classes: { id: string; name: string; scheduleText: string | null; courseName: string }[] };

const classLabel = (status: string) => status === 'open' ? 'Đang mở' : status === 'cancelled' ? 'Đã hủy' : 'Đã kết thúc';

export function CoursesPage() {
  const list = useApi<CoursePayload>('/courses');
  const overdue = useApi<Overdue[]>(list.data?.scope === 'manage' ? '/enrollments/overdue-deferrals' : null);
  if (list.isLoading) return <Loading rows={6} />;
  if (list.error || !list.data) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  if (list.data.scope === 'open') return <OpenList classes={list.data.classes} />;
  return <Manage courses={list.data.courses} overdue={overdue.data ?? []} overdueError={overdue.error} onRetryOverdue={() => overdue.refetch()} />;
}

function OpenList({ classes }: { classes: Extract<CoursePayload, { scope: 'open' }>['classes'] }) {
  return (
    <>
      <div className="page-head"><div><h1>Lớp đang mở</h1><p className="sub">Dùng khi giữ chỗ cho học viên đã thắng.</p></div></div>
      <div className="card">
        {classes.length === 0 ? <Empty title="Chưa có lớp đang mở" /> : (
          <ul className="list">
            {classes.map((c) => <li key={c.id}><strong>{c.courseName}</strong> · {c.name}{c.scheduleText ? ` · ${c.scheduleText}` : ''}</li>)}
          </ul>
        )}
      </div>
    </>
  );
}

function Manage({ courses, overdue, overdueError, onRetryOverdue }: {
  courses: ManageCourse[]; overdue: Overdue[]; overdueError: unknown; onRetryOverdue: () => void;
}) {
  const products = useApi<ProductItem[]>('/products');
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Khóa và lớp</h1>
          <p className="sub">Mỗi khóa thuộc một sản phẩm. Số học viên chỉ đếm ghi danh đã xác nhận và đang học.</p>
        </div>
      </div>
      <div className="cols-main">
        <div className="grid">
          <section className="card" aria-labelledby="overdue-title">
            <div className="card-head"><h2 id="overdue-title">Bảo lưu quá hạn</h2><span className="spacer" /><span className="small muted">{overdue.length}</span></div>
            {overdueError ? <div className="card-body"><ErrorState error={overdueError} onRetry={onRetryOverdue} /></div>
              : overdue.length === 0 ? <Empty title="Không có bảo lưu quá hạn" /> : (
                <ul className="list">
                  {overdue.map((r) => (
                    <li key={r.id} className="row">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Link to="/learners/$contactId" params={{ contactId: r.contactId }}>{r.contactName}</Link>
                        <div className="small muted">{r.courseName} · {r.className} · hạn {fmtDate(r.deferredUntil)}</div>
                      </div>
                      <Link to="/classes/$classId" params={{ classId: r.classId }} className="btn btn-sm">Mở lớp</Link>
                    </li>
                  ))}
                </ul>
              )}
          </section>
          {courses.length === 0 && <Empty title="Chưa có khóa">Tạo khóa từ một sản phẩm, rồi mở lớp.</Empty>}
          {courses.map((course) => (
            <section key={course.id} className="card">
              <div className="card-head">
                <h2>{course.name}</h2>
                <span className="spacer" />
                <Badge tone={course.status === 'active' ? 'ok' : 'neutral'}>{course.status === 'active' ? 'Đang mở' : 'Đã đóng'}</Badge>
              </div>
              <div className="card-body small muted">Sản phẩm: {course.productName}</div>
              {course.classes.length === 0 ? <Empty title="Chưa có lớp" /> : (
                <div className="table-wrap">
                  <table className="table responsive">
                    <thead><tr><th>Lớp</th><th>Lịch</th><th>Trạng thái</th><th className="right">Học viên</th><th className="right">Buổi</th></tr></thead>
                    <tbody>
                      {course.classes.map((cg) => (
                        <tr key={cg.id}>
                          <td><Link to="/classes/$classId" params={{ classId: cg.id }} className="cell-title">{cg.name}</Link></td>
                          <td data-label="Lịch">{cg.scheduleText || '—'}</td>
                          <td data-label="Trạng thái">{classLabel(cg.status)}</td>
                          <td data-label="Học viên" className="right num">{cg.studentCount}</td>
                          <td data-label="Buổi" className="right num">{cg.sessionCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </div>
        <div className="grid">
          <CourseForm products={products.data ?? []} />
          <ClassForm courses={courses} />
        </div>
      </div>
    </>
  );
}

function CourseForm({ products }: { products: ProductItem[] }) {
  const toast = useToast();
  const [form, setForm] = useState({ productId: '', name: '', status: 'active' as 'active' | 'closed' });
  const m = useCommand<UpsertCourseInput>('upsertCourse');
  const errors = fieldErrors(m.error);
  const submit = () => m.mutate(form, { onSuccess: () => { toast('Đã tạo khóa'); setForm({ productId: '', name: '', status: 'active' }); } });
  return (
    <section className="card">
      <div className="card-head"><h2>Tạo khóa</h2></div>
      <form className="card-body stack" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label="Sản phẩm" htmlFor="co-product" required error={errors.productId}>
          <select id="co-product" value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} required>
            <option value="">Chọn sản phẩm</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Tên khóa" htmlFor="co-name" required error={errors.name}>
          <input id="co-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={160} />
        </Field>
        <Field label="Trạng thái" htmlFor="co-status">
          <select id="co-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as 'active' | 'closed' })}>
            <option value="active">Đang mở</option>
            <option value="closed">Đã đóng</option>
          </select>
        </Field>
        <FormError error={m.error && !Object.keys(errors).length ? m.error : null} />
        <button className="btn btn-primary" disabled={m.isPending}>Tạo khóa</button>
      </form>
    </section>
  );
}

function ClassForm({ courses }: { courses: ManageCourse[] }) {
  const toast = useToast();
  const [form, setForm] = useState({ courseId: '', name: '', scheduleText: '', note: '', status: 'open' as UpsertClassInput['status'] });
  const m = useCommand<UpsertClassInput>('upsertClass');
  const errors = fieldErrors(m.error);
  const opt = (v: string) => v.trim() || undefined;
  const submit = () => m.mutate({
    courseId: form.courseId, name: form.name, scheduleText: opt(form.scheduleText), note: opt(form.note), status: form.status,
  }, { onSuccess: () => { toast('Đã tạo lớp'); setForm({ ...form, name: '', scheduleText: '', note: '' }); } });
  return (
    <section className="card">
      <div className="card-head"><h2>Tạo lớp</h2></div>
      <form className="card-body stack" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label="Khóa" htmlFor="cl-course" required error={errors.courseId}>
          <select id="cl-course" value={form.courseId} onChange={(e) => setForm({ ...form, courseId: e.target.value })} required>
            <option value="">Chọn khóa</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Tên lớp" htmlFor="cl-name" required error={errors.name}>
          <input id="cl-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={160} />
        </Field>
        <Field label="Lịch" htmlFor="cl-sched"><input id="cl-sched" value={form.scheduleText} onChange={(e) => setForm({ ...form, scheduleText: e.target.value })} maxLength={200} /></Field>
        <Field label="Link học / ghi chú" htmlFor="cl-note"><textarea id="cl-note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={1000} /></Field>
        <FormError error={m.error && !Object.keys(errors).length ? m.error : null} />
        <button className="btn btn-primary" disabled={m.isPending}>Tạo lớp</button>
      </form>
    </section>
  );
}
