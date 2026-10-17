import { useState } from 'react';
import type {
  AddLessonVideoInput,
  CloneLmsProgramInput,
  CreateClassLearnerAccountsInput,
  CreateLearnerAccountInput,
  DeleteLessonVideoInput,
  UpdateLessonVideoInput,
  UpdateLmsProgramInput,
} from '@abm/contracts';
import { useActor } from '../actor-context';
import { ApiFailure, api, useApi, useCommand } from '../api';
import { fmtDateTime } from '../format';
import type {
  ClassLmsDetail,
  CreateClassLearnerAccountsResult,
  LmsLessonItem,
  LmsLessonVideo,
  LmsProgramInfo,
  LmsProgramOption,
} from '../types';
import { Alert, Badge, Empty, ErrorState, Field, FormError, Loading, Modal, SegmentedControl, fieldErrors, useToast } from './ui';

export function ClassOnlineProgram({ classId }: { classId: string }) {
  const actor = useActor();
  const toast = useToast();
  const isAcademicOrAdmin = actor.role === 'academic' || actor.role === 'admin';
  const can = {
    manageProgram: isAcademicOrAdmin,
    manageAccounts: isAcademicOrAdmin,
    manageVideos: isAcademicOrAdmin || actor.role === 'teacher',
  };
  const canView = isAcademicOrAdmin || actor.role === 'director' || actor.role === 'teacher';

  const q = useApi<ClassLmsDetail>(canView ? `/classes/${classId}/lms` : null);
  const programs = useApi<LmsProgramOption[]>(
    can.manageProgram && q.data && !q.data.program ? '/lms/programs' : null,
  );

  const [fromClassId, setFromClassId] = useState('');
  const [editingProgram, setEditingProgram] = useState(false);
  const [addingVideoLesson, setAddingVideoLesson] = useState<LmsLessonItem | null>(null);
  const [editingVideoId, setEditingVideoId] = useState<string | null>(null);
  const [emailDrafts, setEmailDrafts] = useState<Record<string, string>>({});
  const [batchSkipped, setBatchSkipped] = useState<{ noEmail: string[]; emailTaken: string[] } | null>(null);
  const [previewPending, setPreviewPending] = useState(false);
  const [previewError, setPreviewError] = useState<unknown>(null);

  const cloneCmd = useCommand<CloneLmsProgramInput>('cloneLmsProgram');
  const createAllCmd = useCommand<CreateClassLearnerAccountsInput, CreateClassLearnerAccountsResult>('createClassLearnerAccounts');
  const createOneCmd = useCommand<CreateLearnerAccountInput>('createLearnerAccount');
  const deleteVideoCmd = useCommand<DeleteLessonVideoInput>('deleteLessonVideo');

  if (!canView) return null;
  if (q.isLoading) return <Loading rows={4} />;
  if (q.error instanceof ApiFailure && (q.error.status === 403 || q.error.code === 'FORBIDDEN')) {
    return <Alert tone="warn">Bạn không có quyền xem chương trình của lớp này</Alert>;
  }
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  if (!q.data.program) {
    const cloneOptions = (programs.data ?? []).filter((p) => p.classId && p.classId !== classId);
    return (
      <section className="card">
        <div className="card-head"><h2>Chương trình học online</h2></div>
        <div className="card-body stack">
          <Empty title="Lớp chưa có chương trình học online">
            Agent đăng cẩm nang bằng script, hoặc nhân bản từ lớp khác.
          </Empty>
          {can.manageProgram && (
            <form
              className="stack-sm"
              style={{ maxWidth: 480, margin: '0 auto', width: '100%' }}
              onSubmit={(e) => {
                e.preventDefault();
                if (!fromClassId) return;
                cloneCmd.mutate(
                  { fromClassId, toClassId: classId },
                  {
                    onSuccess: () => {
                      toast('Đã nhân bản chương trình');
                      setFromClassId('');
                      void q.refetch();
                    },
                  },
                );
              }}
            >
              <Field label="Nhân bản từ lớp…" htmlFor={`clone-from-${classId}`}>
                <div className="row">
                  <select
                    id={`clone-from-${classId}`}
                    value={fromClassId}
                    onChange={(e) => setFromClassId(e.target.value)}
                    style={{ flex: 1 }}
                  >
                    <option value="">Chọn lớp có chương trình…</option>
                    {cloneOptions.map((p) => (
                      <option key={p.programId} value={p.classId!}>
                        {p.className ? `${p.className} — ` : ''}{p.title} ({p.lessonCount} phần)
                      </option>
                    ))}
                  </select>
                  <button className="btn btn-primary" disabled={!fromClassId || cloneCmd.isPending}>
                    {cloneCmd.isPending ? 'Đang chép…' : 'Nhân bản'}
                  </button>
                </div>
              </Field>
              <p className="small muted">Chỉ chép các phần bài học, không chép video.</p>
              <FormError error={cloneCmd.error} />
            </form>
          )}
        </div>
      </section>
    );
  }

  const { program, lessons, counts, learnersWithoutAccount, hasDefaultPassword } = q.data;
  const visibleLessons = lessons.filter((l) => !l.hidden);
  const hiddenLessons = lessons.filter((l) => l.hidden);
  // Read from fresh data so a reload after a stale save gives the modal the current version.
  const editingVideo = lessons.flatMap((l) => l.videos).find((v) => v.id === editingVideoId) ?? null;
  const orderedLessons = [...visibleLessons, ...hiddenLessons];

  const openPreview = async () => {
    setPreviewPending(true);
    setPreviewError(null);
    try {
      const res = await api.get<{ url: string }>(`/classes/${encodeURIComponent(classId)}/lms/preview-url`);
      window.open(res.url, '_blank', 'noopener');
    } catch (err) {
      setPreviewError(err);
    } finally {
      setPreviewPending(false);
    }
  };

  const runCreateAll = () => {
    setBatchSkipped(null);
    createAllCmd.mutate(
      { classId },
      {
        onSuccess: (res) => {
          toast(`Đã tạo ${res.created} tài khoản`);
          if (res.skippedNoEmail.length > 0 || res.skippedEmailTaken.length > 0) {
            setBatchSkipped({ noEmail: res.skippedNoEmail, emailTaken: res.skippedEmailTaken });
          }
          void q.refetch();
        },
      },
    );
  };

  const runCreateOne = (contactId: string, existingEmail: string | null) => {
    const draftEmail = emailDrafts[contactId]?.trim();
    createOneCmd.mutate(
      existingEmail ? { contactId } : { contactId, email: draftEmail },
      {
        onSuccess: () => {
          toast('Đã tạo tài khoản học viên');
          setEmailDrafts((prev) => {
            const next = { ...prev };
            delete next[contactId];
            return next;
          });
          void q.refetch();
        },
      },
    );
  };

  const runDeleteVideo = (video: LmsLessonVideo) => {
    if (!window.confirm('Xoá video này khỏi phần?')) return;
    deleteVideoCmd.mutate(
      { videoId: video.id, version: video.version },
      {
        onSuccess: () => {
          toast('Đã xoá video');
          void q.refetch();
        },
      },
    );
  };

  return (
    <section className="card">
      <div className="card-head" style={{ flexWrap: 'wrap' }}>
        <div className="row-wrap">
          <h2>Chương trình học online: {program.title}</h2>
          <Badge tone="agent">
            Phiên bản {program.contentVersion}
            {program.publishedAt ? ` · ${fmtDateTime(program.publishedAt)}` : ''}
          </Badge>
        </div>
        <span className="spacer" />
        <div className="row-wrap">
          <button
            type="button"
            className="btn btn-sm"
            disabled={previewPending}
            onClick={() => void openPreview()}
          >
            {previewPending ? 'Đang mở…' : 'Xem như học viên'}
          </button>
          {can.manageAccounts && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={createAllCmd.isPending}
              onClick={runCreateAll}
            >
              {createAllCmd.isPending ? 'Đang tạo…' : 'Tạo tài khoản cho cả lớp'}
            </button>
          )}
        </div>
      </div>

      <div className="card-body stack">
        <div className="row-wrap small muted">
          <span>
            {counts.withAccount}/{counts.enrolled} học viên có tài khoản · {counts.withoutEmail} chưa có email
          </span>
          <span>·</span>
          <span>
            Xem lại sau khi lớp kết thúc:{' '}
            <strong>{program.reviewDays !== null ? `${program.reviewDays} ngày` : 'không giới hạn'}</strong>
          </span>
          {can.manageProgram && (
            <button type="button" className="btn btn-sm" onClick={() => setEditingProgram(true)}>
              Sửa
            </button>
          )}
        </div>

        {!hasDefaultPassword && (
          <Alert tone="warn">
            Admin chưa đặt mật khẩu mặc định cho học viên — học viên chưa đăng nhập được.
          </Alert>
        )}

        {previewError ? <FormError error={previewError} /> : null}
        <FormError error={createAllCmd.error ?? createOneCmd.error ?? deleteVideoCmd.error} />

        {batchSkipped && (batchSkipped.noEmail.length > 0 || batchSkipped.emailTaken.length > 0) && (
          <Alert tone="warn">
            <div>Một số học viên chưa tạo được tài khoản:</div>
            {batchSkipped.noEmail.length > 0 && (
              <div className="small">Chưa có email: {batchSkipped.noEmail.join(', ')}</div>
            )}
            {batchSkipped.emailTaken.length > 0 && (
              <div className="small">Email đã dùng cho tài khoản khác: {batchSkipped.emailTaken.join(', ')}</div>
            )}
          </Alert>
        )}

        {learnersWithoutAccount.length > 0 && (can.manageAccounts || actor.role === 'director') && (
          <div className="stack-sm">
            <h3>Học viên chưa có tài khoản ({learnersWithoutAccount.length})</h3>
            <div className="table-wrap">
              <table className="table responsive">
                <thead>
                  <tr>
                    <th>Học viên</th>
                    <th>Email</th>
                    {can.manageAccounts && <th className="right">Thao tác</th>}
                  </tr>
                </thead>
                <tbody>
                  {learnersWithoutAccount.map((learner) => {
                    const draft = emailDrafts[learner.contactId] ?? '';
                    return (
                      <tr key={learner.contactId}>
                        <td className="cell-title">{learner.displayName}</td>
                        <td data-label="Email">
                          {learner.email ? (
                            learner.email
                          ) : can.manageAccounts ? (
                            <input
                              type="email"
                              aria-label={`Email cho ${learner.displayName}`}
                              placeholder="Nhập email học viên…"
                              value={draft}
                              onChange={(e) => setEmailDrafts({ ...emailDrafts, [learner.contactId]: e.target.value })}
                              style={{ maxWidth: 280 }}
                            />
                          ) : (
                            <span className="muted">Chưa có email</span>
                          )}
                        </td>
                        {can.manageAccounts && (
                          <td className="right">
                            <button
                              type="button"
                              className="btn btn-sm"
                              disabled={createOneCmd.isPending || (!learner.email && !draft.trim())}
                              onClick={() => runCreateOne(learner.contactId, learner.email)}
                            >
                              Tạo tài khoản
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="stack-sm">
          <h3>Các phần bài học ({orderedLessons.length})</h3>
          {orderedLessons.length === 0 ? (
            <Empty title="Chưa có phần bài học" />
          ) : (
            <div className="table-wrap">
              <table className="table responsive">
                <thead>
                  <tr>
                    <th>Phần</th>
                    <th>Tiêu đề</th>
                    <th>Video</th>
                    {can.manageVideos && <th className="right"><span className="visually-hidden">Thao tác</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {orderedLessons.map((lesson) => (
                    <tr key={lesson.id} className={lesson.hidden ? 'row-muted' : undefined}>
                      <td data-label="Phần" className="mono nowrap">{lesson.sectionId}</td>
                      <td data-label="Tiêu đề">
                        <div className="row-wrap">
                          <span className="cell-title">{lesson.title}</span>
                          {lesson.hidden && <Badge tone="warn">Đã gỡ khỏi cẩm nang</Badge>}
                        </div>
                        {lesson.groupTitle && <div className="cell-sub muted">{lesson.groupTitle}</div>}
                      </td>
                      <td data-label="Video">
                        {lesson.videos.length === 0 ? (
                          <span className="small muted">Chưa có video</span>
                        ) : (
                          <div className="stack-sm">
                            {lesson.videos.map((v) => (
                              <div key={v.id} className="row-wrap">
                                <span>{v.title}</span>
                                {can.manageVideos && (
                                  <>
                                    <button
                                      type="button"
                                      className="btn btn-sm"
                                      onClick={() => setEditingVideoId(v.id)}
                                    >
                                      Sửa
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-danger"
                                      disabled={deleteVideoCmd.isPending}
                                      onClick={() => runDeleteVideo(v)}
                                    >
                                      Xoá
                                    </button>
                                  </>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      {can.manageVideos && (
                        <td className="right nowrap">
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => setAddingVideoLesson(lesson)}
                          >
                            + Video
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {editingProgram && can.manageProgram && (
        <EditProgramModal
          program={program}
          onClose={() => setEditingProgram(false)}
          onSaved={() => {
            setEditingProgram(false);
            void q.refetch();
          }}
        />
      )}

      {addingVideoLesson && can.manageVideos && (
        <AddVideoModal
          lesson={addingVideoLesson}
          onClose={() => setAddingVideoLesson(null)}
          onSaved={() => {
            setAddingVideoLesson(null);
            void q.refetch();
          }}
        />
      )}

      {editingVideo && can.manageVideos && (
        <EditVideoModal
          video={editingVideo}
          onClose={() => setEditingVideoId(null)}
          onSaved={() => {
            setEditingVideoId(null);
            void q.refetch();
          }}
        />
      )}
    </section>
  );
}

function EditProgramModal({
  program,
  onClose,
  onSaved,
}: {
  program: LmsProgramInfo;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(program.title);
  const [reviewDaysStr, setReviewDaysStr] = useState(
    program.reviewDays !== null ? String(program.reviewDays) : '',
  );
  const updateCmd = useCommand<UpdateLmsProgramInput>('updateLmsProgram');
  const errors = fieldErrors(updateCmd.error);

  const submit = () => {
    const trimmedDays = reviewDaysStr.trim();
    const reviewDays = trimmedDays === '' ? null : Number(trimmedDays);
    updateCmd.mutate(
      {
        programId: program.id,
        version: program.version,
        title: title.trim(),
        reviewDays,
      },
      {
        onSuccess: () => {
          toast('Đã cập nhật chương trình');
          onSaved();
        },
      },
    );
  };

  return (
    <Modal
      open
      title="Sửa chương trình học online"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!title.trim() || updateCmd.isPending}
            onClick={submit}
          >
            {updateCmd.isPending ? 'Đang lưu…' : 'Lưu'}
          </button>
        </>
      }
    >
      <FormError error={updateCmd.error} />
      <Field label="Tiêu đề" required error={errors.title} htmlFor="lms-prog-title">
        <input
          id="lms-prog-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          required
        />
      </Field>
      <Field
        label="Xem lại sau khi lớp kết thúc (ngày)"
        error={errors.reviewDays}
        hint="Để trống = không giới hạn"
        htmlFor="lms-prog-review-days"
      >
        <input
          id="lms-prog-review-days"
          type="number"
          min={0}
          max={3650}
          placeholder="Không giới hạn"
          value={reviewDaysStr}
          onChange={(e) => setReviewDaysStr(e.target.value)}
        />
      </Field>
    </Modal>
  );
}

function AddVideoModal({
  lesson,
  onClose,
  onSaved,
}: {
  lesson: LmsLessonItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [sourceKind, setSourceKind] = useState<'stream' | 'url'>('stream');
  const [streamUid, setStreamUid] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const addCmd = useCommand<AddLessonVideoInput>('addLessonVideo');
  const errors = fieldErrors(addCmd.error);

  const canSubmit = Boolean(
    title.trim() && (sourceKind === 'stream' ? streamUid.trim() : sourceUrl.trim()),
  );

  const submit = () => {
    if (!canSubmit) return;
    addCmd.mutate(
      {
        lessonId: lesson.id,
        title: title.trim(),
        ...(sourceKind === 'stream'
          ? { streamUid: streamUid.trim() }
          : { sourceUrl: sourceUrl.trim() }),
      },
      {
        onSuccess: () => {
          toast('Đã thêm video');
          onSaved();
        },
      },
    );
  };

  return (
    <Modal
      open
      title={`Thêm video — ${lesson.title}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canSubmit || addCmd.isPending}
            onClick={submit}
          >
            {addCmd.isPending ? 'Đang lưu…' : 'Lưu video'}
          </button>
        </>
      }
    >
      <FormError error={addCmd.error} />
      <Field label="Tiêu đề" required error={errors.title} htmlFor="lms-video-title">
        <input
          id="lms-video-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder="Ví dụ: Record Zoom buổi 1 — toàn buổi"
          required
        />
      </Field>
      <Field label="Nguồn video">
        <SegmentedControl
          value={sourceKind}
          onChange={setSourceKind}
          ariaLabel="Nguồn video"
          options={[
            { value: 'stream', label: 'ID video Stream' },
            { value: 'url', label: 'Link MP4 công khai' },
          ]}
        />
      </Field>
      {sourceKind === 'stream' ? (
        <Field
          label="ID video Stream"
          required
          error={errors.streamUid}
          hint="Mã 32 ký tự hex trên Cloudflare Stream"
          htmlFor="lms-video-uid"
        >
          <input
            id="lms-video-uid"
            className="mono"
            value={streamUid}
            onChange={(e) => setStreamUid(e.target.value)}
            placeholder="0123456789abcdef0123456789abcdef"
            required
          />
        </Field>
      ) : (
        <Field
          label="Link MP4 công khai"
          required
          error={errors.sourceUrl}
          hint="Chỉ nhận link https:// để Cloudflare Stream tải về"
          htmlFor="lms-video-url"
        >
          <input
            id="lms-video-url"
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://example.com/video.mp4"
            required
          />
        </Field>
      )}
    </Modal>
  );
}

function EditVideoModal({
  video,
  onClose,
  onSaved,
}: {
  video: LmsLessonVideo;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(video.title);
  const [position, setPosition] = useState(String(video.position));
  const updateCmd = useCommand<UpdateLessonVideoInput>('updateLessonVideo');
  const errors = fieldErrors(updateCmd.error);

  const submit = () => {
    if (!title.trim() || position.trim() === '' || !Number.isInteger(Number(position))) return;
    updateCmd.mutate(
      {
        videoId: video.id,
        version: video.version,
        title: title.trim(),
        position: Number(position),
      },
      {
        onSuccess: () => {
          toast('Đã cập nhật video');
          onSaved();
        },
      },
    );
  };

  return (
    <Modal
      open
      title="Sửa video bài học"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!title.trim() || !Number.isInteger(Number(position)) || position.trim() === '' || updateCmd.isPending}
            onClick={submit}
          >
            {updateCmd.isPending ? 'Đang lưu…' : 'Lưu'}
          </button>
        </>
      }
    >
      <FormError error={updateCmd.error} />
      <Field label="Tiêu đề" required error={errors.title} htmlFor="lms-edit-video-title">
        <input
          id="lms-edit-video-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          required
        />
      </Field>
      <Field label="Thứ tự" required error={errors.position} htmlFor="lms-edit-video-pos">
        <input
          id="lms-edit-video-pos"
          type="number"
          min={0}
          max={999}
          value={position}
          onChange={(e) => setPosition(e.target.value)}
          required
        />
      </Field>
    </Modal>
  );
}
