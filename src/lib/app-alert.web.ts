import type { AlertButton } from 'react-native';

function showAlert(title: string, message?: string, buttons?: AlertButton[]) {
  if (typeof document === 'undefined') return;

  const actions = buttons?.length ? buttons : [{ text: 'OK' }];
  const cancelAction = actions.find((action) => action.style === 'cancel');
  const overlay = document.createElement('div');
  overlay.setAttribute('role', 'presentation');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(24,28,24,.48)';

  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'alertdialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.style.cssText = 'box-sizing:border-box;width:min(100%,440px);max-height:90vh;overflow:auto;border-radius:18px;background:#fff;padding:26px;box-shadow:0 20px 60px rgba(0,0,0,.18);font-family:system-ui,sans-serif;color:#292d29';

  const heading = document.createElement('h2');
  heading.textContent = title;
  heading.style.cssText = 'margin:0;font-size:21px;line-height:1.3';
  dialog.appendChild(heading);

  if (message) {
    const copy = document.createElement('p');
    copy.textContent = message;
    copy.style.cssText = 'margin:14px 0 0;font-size:15px;line-height:1.5;white-space:pre-wrap';
    dialog.appendChild(copy);
  }

  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-top:24px';

  function close(action?: AlertButton) {
    document.removeEventListener('keydown', onKeyDown);
    overlay.remove();
    action?.onPress?.();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); close(cancelAction); }
  }

  actions.forEach((action) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.text ?? 'OK';
    const destructive = action.style === 'destructive';
    button.style.cssText = `cursor:pointer;border:1px solid ${destructive ? '#c7443e' : '#d8e3d9'};border-radius:10px;padding:10px 14px;background:${destructive ? '#c7443e' : '#f3f7f3'};color:${destructive ? '#fff' : '#305d4a'};font:700 14px system-ui,sans-serif`;
    button.addEventListener('click', () => close(action));
    footer.appendChild(button);
  });

  dialog.appendChild(footer);
  overlay.appendChild(dialog);
  overlay.addEventListener('click', (event) => { if (event.target === overlay) close(cancelAction); });
  document.addEventListener('keydown', onKeyDown);
  document.body.appendChild(overlay);
  (footer.firstElementChild as HTMLButtonElement | null)?.focus();
}

export const Alert = { alert: showAlert };
