import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../store';
import { toastDismissed, type Toast } from '../toasts';

const SUCCESS_TIMEOUT_MS = 4000;

export function Toasts() {
  const toasts = useAppSelector((state) => state.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <ToastMessage key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

// Success messages fade on their own; errors stay until dismissed so they can be read.
function ToastMessage({ toast }: { toast: Toast }) {
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (toast.kind !== 'success') return;
    const timer = setTimeout(
      () => dispatch(toastDismissed(toast.id)),
      SUCCESS_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [dispatch, toast]);

  return (
    <div
      className={`toast toast-${toast.kind}`}
      role={toast.kind === 'error' ? 'alert' : 'status'}
    >
      <p>{toast.message}</p>
      <button
        type="button"
        className="button-link"
        onClick={() => dispatch(toastDismissed(toast.id))}
      >
        Dismiss
      </button>
    </div>
  );
}
