import { useEffect, useRef, useState } from 'react';
import type {
  DeleteLessonVideoInput,
  ImportLessonVideosInput,
  UpdateLessonVideoInput,
} from '@abm/contracts';
import { useActor } from '../actor-context';
import { ApiFailure, useApi, useCommand } from '../api';
import {
  Alert,
  Badge,
  Empty,
  ErrorState,
  Field,
  FormError,
  Loading,
  useToast,
} from '../components/ui';
import type {
  ClassLmsDetail,
  ImportLessonVideoRow,
  ImportLessonVideosResult,
  LmsLessonVideo,
  LmsProgramOption,
} from '../types';

function shortUid(uid: string) {
  if (!uid) return '—';
  if (uid.length <= 12) return uid;
  return `${uid.slice(0, 8)}…${uid.slice(-4)}`;
}

function StatusChip({ row, committed }: { row: ImportLessonVideoRow; committed: boolean }) {
  switch (row.status) {
    case 'ready':
      return <Badge tone="ok">{committed ? 'Đã lưu' : 'Sẵn sàng'}</Badge>;
    case 'duplicate':
      return <Badge tone="info">{row.message ?? 'Video đã có ở phần này'}</Badge>;
    case 'no_program':
      return <Badge tone="warn">{row.message ?? 'Không nhận ra lớp'}</Badge>;
    case 'no_lesson':
      return <Badge tone="warn">{row.message ?? 'Không nhận ra phần bài học'}</Badge>;
    case 'bad_link':
      return <Badge tone="danger">{row.message ?? 'Không thấy mã video Cloudflare Stream'}</Badge>;
    case 'error':
    default:
      return <Badge tone="danger">{row.message ?? 'Lỗi dữ liệu'}</Badge>;
  }
}

export function LmsVideosPage() {
  const actor = useActor();
  const toast = useToast();
  const canAccess = actor.role === 'academic' || actor.role === 'admin' || actor.role === 'teacher';

  const programs = useApi<LmsProgramOption[]>(canAccess ? '/lms/programs' : null);
  const classPrograms = (programs.data ?? []).filter((p) => p.classId);

  const [text, setText] = useState('');
  const [defaultProgramId, setDefaultProgramId] = useState('');
  const [overrides, setOverrides] = useState<Record<number, string>>({});
  const [preview, setPreview] = useState<ImportLessonVideosResult | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const [selectedClassId, setSelectedClassId] = useState('');
  // Pick the first class once; afterwards the user may clear the choice.
  const autoPickedRef = useRef(false);
  useEffect(() => {
    if (!autoPickedRef.current && classPrograms[0]?.classId) {
      autoPickedRef.current = true;
      setSelectedClassId(classPrograms[0].classId);
    }
  }, [classPrograms]);

  const classDetail = useApi<ClassLmsDetail>(
    canAccess && selectedClassId ? `/classes/${selectedClassId}/lms` : null,
  );

  const previewCmd = useCommand<ImportLessonVideosInput, ImportLessonVideosResult>('importLessonVideos');
  const commitCmd = useCommand<ImportLessonVideosInput, ImportLessonVideosResult>('importLessonVideos');

  if (!canAccess) {
    return <Alert tone="warn">Bạn không có quyền xem trang này.</Alert>;
  }

  const buildInput = (
    commit: boolean,
    nextOverrides: Record<number, string> = overrides,
    nextProgramId: string = defaultProgramId,
  ): ImportLessonVideosInput => {
    const overrideList = Object.entries(nextOverrides)
      .filter(([, lessonId]) => Boolean(lessonId))
      .map(([line, lessonId]) => ({ line: Number(line), lessonId }));
    return {
      text,
      ...(nextProgramId ? { programId: nextProgramId } : {}),
      ...(overrideList.length > 0 ? { overrides: overrideList } : {}),
      commit,
    };
  };

  const runPreview = (
    nextOverrides: Record<number, string> = overrides,
    nextProgramId: string = defaultProgramId,
  ) => {
    if (!text.trim()) return;
    setSavedNotice(null);
    previewCmd.mutate(buildInput(false, nextOverrides, nextProgramId), {
      onSuccess: (res) => {
        setPreview(res);
      },
      // A failed re-check must not leave an older preview whose Save would send unchecked choices.
      onError: () => setPreview(null),
    });
  };

  const handleOverrideSelect = (line: number, lessonId: string) => {
    const next = { ...overrides };
    if (lessonId) {
      next[line] = lessonId;
    } else {
      delete next[line];
    }
    setOverrides(next);
    runPreview(next, defaultProgramId);
  };

  const runCommit = () => {
    if (!preview || preview.summary.ready === 0) return;
    commitCmd.mutate(buildInput(true), {
      onSuccess: (res) => {
        const count = res.summary.ready;
        toast(`Đã lưu ${count} video`);
        setSavedNotice(`Đã lưu ${count} video vào chương trình học.`);
        setPreview(res);
        void classDetail.refetch();
        void programs.refetch();
      },
    });
  };

  const readyCount = preview && !preview.committed ? preview.summary.ready : 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Video bài học</h1>
          <p className="sub">
            Dán nhiều link Cloudflare Stream để gắn nhanh vào từng phần bài học, hoặc đổi tên và xoá video đã gắn.
          </p>
        </div>
      </div>

      <div className="stack">
        <section className="card" aria-labelledby="lms-paste-head">
          <div className="card-head">
            <h2 id="lms-paste-head">Dán link video</h2>
          </div>
          <div className="card-body stack">
            <Field
              label="Danh sách video (mỗi dòng 1 video, tối đa 100 dòng)"
              htmlFor="lms-video-paste"
              hint="Định dạng: <Tên lớp> <Mã phần> <Tiêu đề video> | <Link Cloudflare Stream hoặc UID 32 ký tự hex>"
            >
              <textarea
                id="lms-video-paste"
                rows={6}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setPreview(null);
                  setOverrides({});
                  setSavedNotice(null);
                }}
                placeholder="BSR-AI-K1 b2m1 Buổi 2 – Agent cơ bản | https://customer-xxx.cloudflarestream.com/0123456789abcdef0123456789abcdef/watch"
              />
            </Field>

            <div className="row-wrap" style={{ alignItems: 'flex-end' }}>
              <Field label="Chương trình mặc định" htmlFor="lms-default-program">
                <select
                  id="lms-default-program"
                  value={defaultProgramId}
                  onChange={(e) => {
                    const nextProg = e.target.value;
                    setDefaultProgramId(nextProg);
                    if (preview && text.trim()) {
                      runPreview(overrides, nextProg);
                    }
                  }}
                  style={{ minWidth: 280 }}
                >
                  <option value="">Tự nhận theo tên lớp</option>
                  {classPrograms.map((p) => (
                    <option key={p.programId} value={p.programId}>
                      {p.className ? `${p.className} — ` : ''}{p.title}
                    </option>
                  ))}
                </select>
              </Field>

              <button
                type="button"
                className="btn"
                disabled={!text.trim() || previewCmd.isPending || commitCmd.isPending}
                onClick={() => runPreview()}
              >
                {previewCmd.isPending ? 'Đang kiểm tra…' : 'Xem trước'}
              </button>

              {preview && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={readyCount === 0 || commitCmd.isPending || previewCmd.isPending}
                  onClick={runCommit}
                >
                  {commitCmd.isPending ? 'Đang lưu…' : `Lưu ${readyCount} video`}
                </button>
              )}
            </div>

            <FormError error={previewCmd.error ?? commitCmd.error} />

            {savedNotice && <Alert tone="ok">{savedNotice}</Alert>}

            {preview && (
              <div className="stack-sm">
                <div className="row-wrap">
                  <Badge tone="ok">{preview.summary.ready} {preview.committed ? 'đã lưu' : 'sẵn sàng'}</Badge>
                  <Badge tone="info">{preview.summary.duplicate} trùng lặp</Badge>
                  <Badge tone="warn">{preview.summary.unmatched} chưa nhận ra lớp/phần</Badge>
                  <Badge tone="danger">{preview.summary.errors} lỗi</Badge>
                </div>

                {preview.rows.length === 0 ? (
                  <Empty title="Không có dòng dữ liệu nào" />
                ) : (
                  <div className="table-wrap">
                    <table className="table responsive">
                      <thead>
                        <tr>
                          <th>Dòng</th>
                          <th>Tiêu đề</th>
                          <th>Lớp / Phần bài học</th>
                          <th>Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.rows.map((row) => {
                          // A saved paste is read-only; editing the text starts a new preview.
                          // Every linkable row can be re-pointed before saving, including auto-matched ones.
                          const needsLessonSelect = !preview.committed && Boolean(row.streamUid) && Boolean(row.title);
                          return (
                            <tr key={row.line}>
                              <td data-label="Dòng" className="num">{row.line}</td>
                              <td data-label="Tiêu đề">
                                <div className="cell-title">{row.title || <span className="muted">(Trống)</span>}</div>
                                {row.streamUid && (
                                  <div className="cell-sub mono muted" title={row.streamUid}>
                                    UID: {shortUid(row.streamUid)}
                                  </div>
                                )}
                              </td>
                              <td data-label="Lớp / Phần bài học">
                                {row.lessonId && (
                                  <div>
                                    <strong>{row.className ?? row.programTitle}</strong>
                                    {' · '}
                                    <span className="mono">{row.sectionId}</span>
                                    {' — '}
                                    <span>{row.lessonTitle}</span>
                                  </div>
                                )}
                                {!row.lessonId && row.programId && (
                                  <div className="small muted">
                                    Lớp: <strong>{row.className ?? row.programTitle}</strong>
                                  </div>
                                )}
                                {needsLessonSelect && (
                                  <div style={{ marginTop: row.lessonId || row.programId ? 6 : 0 }}>
                                    <select
                                      aria-label={`Chọn phần bài học cho dòng ${row.line}`}
                                      value={overrides[row.line] ?? ''}
                                      onChange={(e) => handleOverrideSelect(row.line, e.target.value)}
                                      style={{ maxWidth: 340 }}
                                    >
                                      <option value="">{overrides[row.line] ? 'Bỏ chọn tay' : row.lessonId ? 'Giữ phần đã nhận' : 'Chọn phần bài học…'}</option>
                                      {classPrograms.map((p) => (
                                        <optgroup
                                          key={p.programId}
                                          label={`${p.className ? `${p.className} — ` : ''}${p.title}`}
                                        >
                                          {(p.lessons ?? []).map((l) => (
                                            <option key={l.id} value={l.id}>
                                              {l.sectionId} — {l.title}
                                            </option>
                                          ))}
                                        </optgroup>
                                      ))}
                                    </select>
                                  </div>
                                )}
                                {!row.lessonId && !row.programId && !needsLessonSelect && (
                                  <span className="muted">—</span>
                                )}
                              </td>
                              <td data-label="Trạng thái">
                                <StatusChip row={row} committed={preview.committed} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="card" aria-labelledby="lms-attached-head">
          <div className="card-head" style={{ flexWrap: 'wrap' }}>
            <h2 id="lms-attached-head">Video đã gắn</h2>
            <span className="spacer" />
            <select
              aria-label="Chọn chương trình xem video đã gắn"
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value)}
              style={{ minWidth: 280 }}
            >
              <option value="">Chọn chương trình…</option>
              {classPrograms.map((p) => (
                <option key={p.programId} value={p.classId!}>
                  {p.className ? `${p.className} — ` : ''}{p.title} ({p.lessonCount} phần)
                </option>
              ))}
            </select>
          </div>

          <div className="card-body stack">
            {programs.isLoading ? (
              <Loading rows={3} />
            ) : !selectedClassId ? (
              <Empty title="Chọn một chương trình để xem danh sách video đã gắn" />
            ) : classDetail.isLoading ? (
              <Loading rows={4} />
            ) : classDetail.error instanceof ApiFailure &&
              (classDetail.error.status === 403 || classDetail.error.code === 'FORBIDDEN') ? (
              <Alert tone="warn">Bạn không có quyền xem chương trình của lớp này.</Alert>
            ) : classDetail.error || !classDetail.data ? (
              <ErrorState error={classDetail.error} onRetry={() => classDetail.refetch()} />
            ) : !classDetail.data.program ? (
              <Empty title="Lớp này chưa có chương trình học online" />
            ) : (
              <AttachedVideosList
                detail={classDetail.data}
                onChanged={() => void classDetail.refetch()}
              />
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function AttachedVideosList({
  detail,
  onChanged,
}: {
  detail: Extract<ClassLmsDetail, { program: NonNullable<ClassLmsDetail['program']> }>;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const updateCmd = useCommand<UpdateLessonVideoInput>('updateLessonVideo');
  const deleteCmd = useCommand<DeleteLessonVideoInput>('deleteLessonVideo');

  const startRename = (v: LmsLessonVideo) => {
    setRenamingId(v.id);
    setRenameDraft(v.title);
    setConfirmDeleteId(null);
  };

  const submitRename = (v: LmsLessonVideo) => {
    const trimmed = renameDraft.trim();
    if (!trimmed) return;
    updateCmd.mutate(
      { videoId: v.id, version: v.version, title: trimmed },
      {
        onSuccess: () => {
          toast('Đã đổi tên video');
          setRenamingId(null);
          onChanged();
        },
      },
    );
  };

  const submitDelete = (v: LmsLessonVideo) => {
    deleteCmd.mutate(
      { videoId: v.id, version: v.version },
      {
        onSuccess: () => {
          toast('Đã xoá video');
          setConfirmDeleteId(null);
          onChanged();
        },
      },
    );
  };

  const visibleLessons = detail.lessons.filter((l) => !l.hidden);
  const hiddenLessons = detail.lessons.filter((l) => l.hidden);
  const orderedLessons = [...visibleLessons, ...hiddenLessons];

  if (orderedLessons.length === 0) {
    return <Empty title="Chương trình chưa có phần bài học nào" />;
  }

  return (
    <div className="stack-sm">
      <FormError error={updateCmd.error ?? deleteCmd.error} />
      <div className="table-wrap">
        <table className="table responsive">
          <thead>
            <tr>
              <th>Phần</th>
              <th>Bài học</th>
              <th>Video đã gắn</th>
            </tr>
          </thead>
          <tbody>
            {orderedLessons.map((lesson) => (
              <tr key={lesson.id} className={lesson.hidden ? 'row-muted' : undefined}>
                <td data-label="Phần" className="mono nowrap">{lesson.sectionId}</td>
                <td data-label="Bài học">
                  <div className="row-wrap">
                    <span className="cell-title">{lesson.title}</span>
                    {lesson.hidden && <Badge tone="warn">Đã ẩn</Badge>}
                  </div>
                  {lesson.groupTitle && <div className="cell-sub muted">{lesson.groupTitle}</div>}
                </td>
                <td data-label="Video đã gắn">
                  {lesson.videos.length === 0 ? (
                    <span className="small muted">Chưa có video</span>
                  ) : (
                    <div className="stack-sm">
                      {lesson.videos.map((v) => {
                        const isRenaming = renamingId === v.id;
                        const isConfirmingDelete = confirmDeleteId === v.id;
                        return (
                          <div key={v.id} className="row-wrap" style={{ gap: 8 }}>
                            {isRenaming ? (
                              <>
                                <input
                                  type="text"
                                  aria-label="Tiêu đề video"
                                  value={renameDraft}
                                  maxLength={200}
                                  onChange={(e) => setRenameDraft(e.target.value)}
                                  style={{ minWidth: 240, flex: 1 }}
                                />
                                <button
                                  type="button"
                                  className="btn btn-sm btn-primary"
                                  disabled={!renameDraft.trim() || updateCmd.isPending}
                                  onClick={() => submitRename(v)}
                                >
                                  {updateCmd.isPending ? 'Đang lưu…' : 'Lưu'}
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  onClick={() => setRenamingId(null)}
                                >
                                  Hủy
                                </button>
                              </>
                            ) : (
                              <>
                                <span className="cell-title">{v.title}</span>
                                <span className="mono small muted" title={v.streamUid}>
                                  ({shortUid(v.streamUid)})
                                </span>
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  onClick={() => startRename(v)}
                                >
                                  Đổi tên
                                </button>
                                {isConfirmingDelete ? (
                                  <>
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-danger"
                                      disabled={deleteCmd.isPending}
                                      onClick={() => submitDelete(v)}
                                    >
                                      {deleteCmd.isPending ? 'Đang xoá…' : 'Xác nhận xoá'}
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-sm"
                                      onClick={() => setConfirmDeleteId(null)}
                                    >
                                      Hủy
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-danger"
                                    onClick={() => {
                                      setConfirmDeleteId(v.id);
                                      setRenamingId(null);
                                    }}
                                  >
                                    Xoá
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
