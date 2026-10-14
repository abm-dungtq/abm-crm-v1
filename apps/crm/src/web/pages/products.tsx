import { useState } from 'react';
import type { UpsertProductInput } from '@abm/contracts';
import { useActor } from '../actor-context';
import { useApi, useCommand } from '../api';
import { Badge, Empty, ErrorState, Field, FormError, Loading, fieldErrors, useToast } from '../components/ui';
import { fmtMoney } from '../format';
import type { ProductItem } from '../types';

export const canEditCatalogue = (role: string) => role === 'academic' || role === 'admin' || role === 'leader';

export function ProductsPage() {
  const actor = useActor();
  const list = useApi<ProductItem[]>('/products');
  const editable = canEditCatalogue(actor.role);
  const [editing, setEditing] = useState<ProductItem | null>(null);
  const rows = list.data ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Chương trình</h1>
          <p className="sub">Danh mục chương trình đào tạo bán cho học viên và doanh nghiệp. Giá niêm yết nằm trên chương trình.</p>
        </div>
      </div>
      {list.isLoading && <Loading rows={4} />}
      {list.error && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
      {list.data && (
        <div className="cols-main">
          <div className="card">
            {rows.length === 0 && <Empty title="Chưa có chương trình" />}
            {rows.length > 0 && (
              <div className="table-wrap">
                <table className="table responsive">
                  <thead>
                    <tr><th>Tên chương trình</th><th>Khóa học</th><th className="right">Giá</th><th>Trạng thái</th>{editable && <th />}</tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => {
                      const activeCourses = (p.courses ?? []).filter((c) => c.status === 'active');
                      return (
                        <tr key={p.id}>
                          <td>
                            <div className="cell-title">{p.name}</div>
                            {p.description && <div className="small muted">{p.description}</div>}
                          </td>
                          <td data-label="Khóa học">
                            {activeCourses.length > 0 ? (
                              <span className="small">{activeCourses.map((c) => c.name).join(' · ')}</span>
                            ) : (
                              <span className="small muted">Chưa có khóa mở</span>
                            )}
                          </td>
                          <td data-label="Giá" className="right num">
                            {p.priceVnd === 0 ? <span className="small muted">Miễn phí / báo giá riêng</span> : fmtMoney(p.priceVnd, false)}
                          </td>
                          <td data-label="Trạng thái">{p.active ? <Badge tone="ok" dot>Còn bán</Badge> : <Badge tone="neutral">Ngừng bán</Badge>}</td>
                          {editable && <td className="right"><button className="btn btn-sm" onClick={() => setEditing(p)}>Sửa</button></td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {editable && <ProductForm key={editing?.id ?? 'new'} product={editing} onSaved={() => setEditing(null)} />}
        </div>
      )}
    </>
  );
}

function ProductForm({ product, onSaved }: { product: ProductItem | null; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: product?.name ?? '', description: product?.description ?? '', price: product ? String(product.priceVnd) : '', active: Boolean(product?.active ?? true),
  });
  const m = useCommand<UpsertProductInput>('upsertProduct');
  const errors = fieldErrors(m.error);
  const submit = () => m.mutate({
    id: product?.id, version: product?.version, name: form.name, description: form.description.trim() || undefined,
    priceVnd: Number(form.price), active: form.active,
  }, { onSuccess: () => { toast(product ? 'Đã lưu chương trình' : 'Đã thêm chương trình'); if (!product) setForm({ name: '', description: '', price: '', active: true }); onSaved(); } });

  return (
    <section className="card">
      <div className="card-head">
        <h2>{product ? 'Sửa chương trình' : 'Thêm chương trình'}</h2>
        {product && (
          <>
            <span className="spacer" />
            <button type="button" className="btn btn-ghost btn-sm" onClick={onSaved}>Tạo mới</button>
          </>
        )}
      </div>
      <form className="card-body stack" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label="Tên chương trình" htmlFor="pd-name" required error={errors.name}>
          <input id="pd-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={160} />
        </Field>
        <Field label="Mô tả" htmlFor="pd-desc">
          <textarea id="pd-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={2000} />
        </Field>
        <Field label="Giá (đồng)" hint="Nhập 0 nếu miễn phí hoặc báo giá riêng." htmlFor="pd-price" required error={errors.priceVnd}>
          <input id="pd-price" type="number" min={0} step={1} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required />
        </Field>
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
          Còn bán
        </label>
        <FormError error={m.error && !Object.keys(errors).length ? m.error : null} />
        <button className="btn btn-primary" disabled={m.isPending}>{m.isPending ? 'Đang lưu…' : 'Lưu'}</button>
      </form>
    </section>
  );
}
