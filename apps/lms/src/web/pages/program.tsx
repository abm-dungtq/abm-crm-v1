import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ApiFailure, api, useApi, type LearnerMe, type LessonItem, type ProgramDetail } from '../api';
import { Header } from './home';


export function ProgramPage({
  me,
  programId,
  phan,
}: {
  me: LearnerMe;
  programId: string;
  phan?: string;
}) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);

  const detail = useApi<ProgramDetail>(`/programs/${encodeURIComponent(programId)}`);

  // Each detail fetch signs a fresh link; keep the loaded one until the handbook version changes so a
  // background refetch does not reload the frame and lose the reader's place. Lesson switches only change the hash.
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  useEffect(() => {
    const next = detail.data?.contentUrl;
    if (!next) return;
    setFrameSrc((prev) => (prev && prev.split('?')[0] === next.split('?')[0] ? prev : next));
  }, [detail.data?.contentUrl]);

  const lessons = detail.data?.lessons ?? [];
  const currentLesson = useMemo(() => {
    if (lessons.length === 0) return null;
    if (phan) {
      const found = lessons.find((l) => l.sectionId === phan);
      if (found) return found;
    }
    return lessons[0] ?? null;
  }, [lessons, phan]);

  const sectionId = currentLesson?.sectionId ?? '';

  useEffect(() => {
    const firstVideo = currentLesson?.videos[0]?.id ?? null;
    setSelectedVideoId(firstVideo);
  }, [currentLesson?.id]);

  useEffect(() => {
    if (!selectedVideoId) {
      setIframeUrl(null);
      setVideoError(null);
      return;
    }
    let cancelled = false;
    setIframeUrl(null);
    setVideoError(null);
    api
      .get<{ iframeUrl: string }>(`/videos/${encodeURIComponent(selectedVideoId)}/token`)
      .then((res) => {
        if (!cancelled) setIframeUrl(res.iframeUrl);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setVideoError(err instanceof ApiFailure ? err.message : 'Không tải được video');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedVideoId]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as { type?: unknown; sectionId?: unknown } | null;
      if (data && data.type === 'abm-lms:section' && typeof data.sectionId === 'string') {
        void navigate({
          to: '/hoc/$programId',
          params: { programId },
          search: { phan: data.sectionId },
          replace: true,
        });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [navigate, programId]);

  const selectLesson = (targetSectionId: string) => {
    void navigate({
      to: '/hoc/$programId',
      params: { programId },
      search: { phan: targetSectionId },
    });
    frameRef.current?.contentWindow?.postMessage(
      { type: 'abm-lms:goto', sectionId: targetSectionId },
      '*',
    );
  };

  const toggleProgress = useMutation<{ done: boolean }, ApiFailure, { lessonId: string; done: boolean }>({
    mutationFn: ({ lessonId, done }) =>
      api.put(`/lessons/${encodeURIComponent(lessonId)}/progress`, { done }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: [`/programs/${encodeURIComponent(programId)}`] });
      void client.invalidateQueries({ queryKey: ['/programs'] });
    },
  });

  const groups = useMemo(() => {
    const out: { title: string; items: LessonItem[] }[] = [];
    for (const l of lessons) {
      const gTitle = l.groupTitle ?? 'Bài học';
      const last = out[out.length - 1];
      if (!last || last.title !== gTitle) {
        out.push({ title: gTitle, items: [l] });
      } else {
        last.items.push(l);
      }
    }
    return out;
  }, [lessons]);

  if (detail.isLoading) {
    return (
      <div>
        <Header me={me} />
        <div className="empty-state">Đang tải chương trình học…</div>
      </div>
    );
  }

  if (detail.error || !detail.data) {
    return (
      <div>
        <Header me={me} />
        <div className="empty-state">
          <div className="alert-danger" style={{ display: 'inline-block' }}>
            {detail.error?.message ?? 'Không tìm thấy chương trình'}
          </div>
        </div>
      </div>
    );
  }

  const currentIndex = currentLesson ? lessons.findIndex((l) => l.id === currentLesson.id) : -1;
  const prevLesson = currentIndex > 0 ? lessons[currentIndex - 1] : null;
  const nextLesson =
    currentIndex >= 0 && currentIndex < lessons.length - 1 ? lessons[currentIndex + 1] : null;

  return (
    <div>
      <Header me={me} />
      <div className="lesson">
        <nav aria-label="Các phần">
          {groups.map((g, gi) => (
            <div key={`${gi}-${g.title}`}>
              <h4>{g.title}</h4>
              {g.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-current={item.sectionId === sectionId}
                  onClick={() => selectLesson(item.sectionId)}
                >
                  <span>{item.title}</span>
                  {item.done && (
                    <span className="dn" aria-label="đã học">
                      ✓
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="lesson-center">
          <iframe
            ref={frameRef}
            className="handbook-frame"
            title="Nội dung bài học"
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
            allow="clipboard-write"
            src={`${frameSrc ?? detail.data.contentUrl}#${sectionId}`}
          />
          <div className="lesson-actions">
            <button
              type="button"
              className="btn"
              disabled={!prevLesson}
              onClick={() => prevLesson && selectLesson(prevLesson.sectionId)}
            >
              ← Phần trước
            </button>
            {currentLesson && (
              <button
                type="button"
                className="btn pri"
                disabled={toggleProgress.isPending}
                onClick={() =>
                  toggleProgress.mutate({
                    lessonId: currentLesson.id,
                    done: !currentLesson.done,
                  })
                }
              >
                {currentLesson.done ? '✓ Đã học' : '✓ Đánh dấu đã học'}
              </button>
            )}
            <button
              type="button"
              className="btn"
              disabled={!nextLesson}
              onClick={() => nextLesson && selectLesson(nextLesson.sectionId)}
            >
              Phần sau →
            </button>
          </div>
        </div>

        <aside className="vid">
          <h3 style={{ marginTop: 0 }}>🎬 Video bài học</h3>
          {!currentLesson || currentLesson.videos.length === 0 ? (
            <div className="player">Chưa có video cho phần này</div>
          ) : (
            <>
              <div className="player">
                {videoError ? (
                  <span>{videoError}</span>
                ) : iframeUrl ? (
                  <iframe
                    src={iframeUrl}
                    title="Video bài học"
                    allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
                    allowFullScreen
                  />
                ) : (
                  <span>Đang tải video…</span>
                )}
              </div>
              <div className="vlist">
                {currentLesson.videos.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    aria-pressed={v.id === selectedVideoId}
                    onClick={() => setSelectedVideoId(v.id)}
                  >
                    ▶ {v.title}
                  </button>
                ))}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
