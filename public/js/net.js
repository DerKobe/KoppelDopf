// WebSocket-Verbindung mit automatischem Wiederverbinden.
export function createNet({ onMessage, onOpen, onClose }) {
  let ws = null;
  let retry = 0;
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => { retry = 0; onOpen?.(); };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      onMessage(msg);
    };
    ws.onclose = () => {
      onClose?.();
      setTimeout(connect, Math.min(5000, 400 * 2 ** retry++));
    };
  }
  connect();
  return {
    send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); },
    get connected() { return ws && ws.readyState === 1; },
  };
}
