import { assertDxlinkUrl } from './protocol.js';
import type { DxlinkSocket } from './session.js';

export function openLiveDxlinkSocket(url: string, hooks?: { onCloseCode?: (code: number) => void }): DxlinkSocket {
  assertDxlinkUrl(url);
  const ws = new WebSocket(url);
  let messageHandler: ((frame: string) => void) | null = null;
  let closeHandler: (() => void) | null = null;
  const pending: string[] = [];
  let open = false;

  ws.addEventListener('open', () => {
    open = true;
    for (const frame of pending.splice(0)) ws.send(frame);
  });
  ws.addEventListener('message', (event) => {
    const data = event.data;
    if (typeof data === 'string') messageHandler?.(data);
    else if (data instanceof ArrayBuffer) messageHandler?.(Buffer.from(data).toString('utf8'));
    else if (ArrayBuffer.isView(data)) messageHandler?.(Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8'));
  });
  ws.addEventListener('close', (event) => {
    open = false;
    hooks?.onCloseCode?.(event.code);
    closeHandler?.();
  });
  ws.addEventListener('error', () => {
    if (ws.readyState === WebSocket.CONNECTING) ws.close();
  });

  return {
    send(frame: string) {
      if (open && ws.readyState === WebSocket.OPEN) ws.send(frame);
      else pending.push(frame);
    },
    close() {
      pending.splice(0);
      ws.close();
    },
    onMessage(handler) {
      messageHandler = handler;
    },
    onClose(handler) {
      closeHandler = handler;
    },
  };
}
