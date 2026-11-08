/** Included in the served bootstrap; uses the browser's modal focus and inertness. */
export const floatingPopup = String.raw`
      const launcher = document.createElement('button'), dialog = document.createElement('dialog'), close = document.createElement('button');
      launcher.type = 'button'; launcher.textContent = 'Book a time';
      launcher.setAttribute('aria-haspopup', 'dialog'); launcher.setAttribute('aria-expanded', 'false');
      launcher.style.cssText = 'position:fixed;z-index:2147483646;right:20px;bottom:20px;max-width:calc(100% - 40px);min-height:48px;padding:12px 22px;border:1px solid #164e40;border-radius:999px;background:#164e40;color:white;font:600 16px system-ui;cursor:pointer';
      dialog.setAttribute('aria-label', 'Schedule a time');
      dialog.style.cssText = 'position:fixed;inset:0;box-sizing:border-box;width:min(760px,calc(100% - 24px));max-width:none;max-height:calc(100% - 24px);padding:12px;border:1px solid #d5ddd8;border-radius:18px;background:#fffefa;color:#1d1c1a;overflow:auto;overscroll-behavior:contain';
      close.type = 'button'; close.textContent = 'Close'; close.setAttribute('aria-label', 'Close scheduling window');
      close.style.cssText = 'display:block;margin:0 0 8px auto;min-height:44px;padding:0 16px;border:1px solid #d5ddd8;border-radius:8px;background:white;color:#1d1c1a;font:600 14px system-ui;cursor:pointer';
      let activeFrame, previousOverflow;
      const cleanup = () => {
        if (!activeFrame) return;
        frames.delete(activeFrame); dismissers.delete(activeFrame.contentWindow); activeFrame.remove(); activeFrame = undefined;
        document.documentElement.style.overflow = previousOverflow;
        launcher.setAttribute('aria-expanded', 'false'); launcher.focus();
      };
      const dismiss = () => { dialog.close(); cleanup(); };
      close.addEventListener('click', dismiss);
      dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
      dialog.addEventListener('click', event => { if (event.target === dialog) {
        const bounds = dialog.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dismiss();
      } });
      // Native close events are queued and can arrive after a new opening.
      dialog.addEventListener('close', () => { if (!dialog.open) cleanup(); });
      launcher.addEventListener('click', () => {
        if (dialog.open) { close.focus(); return; }
        cleanup();
        activeFrame = frame(); activeFrame.loading = 'eager'; dialog.append(activeFrame);
        dismissers.set(activeFrame.contentWindow, dismiss);
        previousOverflow = document.documentElement.style.overflow;
        document.documentElement.style.overflow = 'hidden';
        dialog.showModal(); launcher.setAttribute('aria-expanded', 'true'); close.focus();
      });
      dialog.append(close); document.body.append(launcher, dialog);
`;
