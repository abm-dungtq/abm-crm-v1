import { useEffect, useState } from 'react';
import { ApiFailure, api, currentAuthMode, currentDemoUser, useApi } from '../api';
import { Alert, ErrorState, FormError, Loading, useToast } from '../components/ui';

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function arrayBufferToBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) return '';
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pushApiHeaders(): Headers {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const demoUser = currentDemoUser();
  if (demoUser && currentAuthMode() !== 'password') {
    headers.set('X-Demo-User', demoUser);
  }
  return headers;
}

async function deletePushSubscription(endpoint: string): Promise<void> {
  const response = await fetch('/api/push/subscriptions', {
    method: 'DELETE',
    headers: pushApiHeaders(),
    body: JSON.stringify({ endpoint }),
  });
  const body = (await response.json().catch(() => null)) as {
    ok: boolean;
    error?: { code: string; message: string };
  } | null;
  if (!body || !body.ok) {
    throw new ApiFailure(
      (body?.error ?? { code: 'INTERNAL', message: 'Không thể tắt thông báo đẩy' }) as never,
      response.status,
    );
  }
}

/**
 * Called on logout so the next person on a shared device does not get this user's message previews: asks the
 * server to forget this device's subscription and unsubscribes it locally. Fire-and-forget: it never throws and
 * nothing waits for it, so logout is never blocked or delayed.
 */
export function forgetPushSubscriptionOnLogout(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  void (async () => {
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const sub = await registration?.pushManager?.getSubscription();
      if (!sub) return;
      // keepalive lets the request finish after the page has navigated away.
      void fetch('/api/push/subscriptions', {
        method: 'DELETE',
        headers: pushApiHeaders(),
        body: JSON.stringify({ endpoint: sub.endpoint }),
        keepalive: true,
      }).catch(() => undefined);
      await sub.unsubscribe();
    } catch {
      // Best effort only.
    }
  })();
}

export function NotificationSettingsPage() {
  const toast = useToast();
  const pushKeyQuery = useApi<{ publicKey: string | null }>('/push/key');
  const [subEndpoint, setSubEndpoint] = useState<string | null>(null);
  const [checkingSub, setCheckingSub] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<ApiFailure | null>(null);

  const supported =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;

  useEffect(() => {
    if (!supported) {
      setCheckingSub(false);
      return;
    }
    let active = true;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        if (active) {
          setSubEndpoint(sub?.endpoint ?? null);
          setCheckingSub(false);
        }
      })
      .catch(() => {
        if (active) setCheckingSub(false);
      });
    return () => {
      active = false;
    };
  }, [supported]);

  const handleEnable = async () => {
    setActionError(null);
    if (!supported) {
      setActionError(
        new ApiFailure({ code: 'VALIDATION_FAILED', message: 'Trình duyệt hiện tại chưa hỗ trợ Web Push' }, 422),
      );
      return;
    }
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setActionError(
          new ApiFailure(
            { code: 'FORBIDDEN', message: 'Bạn cần cho phép quyền thông báo trong trình duyệt để bật thông báo đẩy' },
            403,
          ),
        );
        return;
      }

      const keyRes = await api.get<{ publicKey: string | null }>('/push/key');
      if (!keyRes.publicKey) {
        setActionError(
          new ApiFailure({ code: 'VALIDATION_FAILED', message: 'Máy chủ chưa cấu hình thông báo đẩy' }, 422),
        );
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyRes.publicKey),
      });

      const json = subscription.toJSON();
      const p256dh = json.keys?.p256dh || arrayBufferToBase64Url(subscription.getKey('p256dh'));
      const auth = json.keys?.auth || arrayBufferToBase64Url(subscription.getKey('auth'));

      await api.post('/push/subscriptions', {
        endpoint: subscription.endpoint,
        keys: { p256dh, auth },
        userAgent: navigator.userAgent,
      });

      setSubEndpoint(subscription.endpoint);
      toast('Đã bật thông báo trên thiết bị này');
    } catch (err) {
      setActionError(
        err instanceof ApiFailure
          ? err
          : new ApiFailure({ code: 'INTERNAL', message: err instanceof Error ? err.message : 'Không thể bật thông báo đẩy' }, 500),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    setActionError(null);
    setBusy(true);
    try {
      const registration = supported ? await navigator.serviceWorker.ready : null;
      const sub = await registration?.pushManager.getSubscription();
      const endpoint = sub?.endpoint ?? subEndpoint;
      if (sub) {
        await sub.unsubscribe();
      }
      if (endpoint) {
        await deletePushSubscription(endpoint);
      }
      setSubEndpoint(null);
      toast('Đã tắt thông báo đẩy trên thiết bị này');
    } catch (err) {
      setActionError(
        err instanceof ApiFailure
          ? err
          : new ApiFailure({ code: 'INTERNAL', message: err instanceof Error ? err.message : 'Không thể tắt thông báo đẩy' }, 500),
      );
    } finally {
      setBusy(false);
    }
  };

  if (pushKeyQuery.isLoading || checkingSub) return <Loading rows={3} />;
  if (pushKeyQuery.error) return <ErrorState error={pushKeyQuery.error} onRetry={() => pushKeyQuery.refetch()} />;

  const publicKey = pushKeyQuery.data?.publicKey ?? null;

  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <div>
        <h1>Cài đặt thông báo</h1>
        <p className="text-2">
          Nhận thông báo đẩy trên điện thoại hoặc máy tính khi có tin nhắn riêng, nhắc tên (@mention), giao việc mới,
          việc sắp đến hạn hoặc yêu cầu duyệt.
        </p>
      </div>

      <Alert tone="info">
        Trên iPhone, mở CRM bằng Safari, bấm Chia sẻ → Thêm vào MH chính, rồi bật thông báo trong app đó.
      </Alert>

      {publicKey === null ? (
        <Alert tone="warn">Máy chủ chưa cấu hình thông báo đẩy</Alert>
      ) : (
        <div className="card">
          <div className="card-body stack">
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div className="stack-sm" style={{ gap: 4 }}>
                <strong>Thông báo đẩy trên thiết bị này</strong>
                <span className="small muted">
                  Trạng thái: {subEndpoint ? 'Đang bật trên thiết bị này' : 'Chưa bật'}
                </span>
              </div>

              <div className="row" style={{ gap: 8 }}>
                {subEndpoint ? (
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => void handleDisable()}
                  >
                    {busy ? 'Đang xử lý…' : 'Tắt'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => void handleEnable()}
                  >
                    {busy ? 'Đang bật…' : 'Bật thông báo trên thiết bị này'}
                  </button>
                )}
              </div>
            </div>

            <FormError error={actionError} />
          </div>
        </div>
      )}
    </div>
  );
}
