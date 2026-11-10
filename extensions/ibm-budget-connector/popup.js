const status = document.getElementById('status');
const connect = document.getElementById('connect');
const disconnect = document.getElementById('disconnect');

async function update(type = 'POPUP_STATUS') {
  connect.disabled = true;
  disconnect.disabled = true;
  try {
    if (type === 'CONNECT_DEMO') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url || new URL(tab.url).origin !== 'http://localhost:3000') {
        status.textContent = 'Abre la demo en http://localhost:3000 y vuelve a pulsar Conectar esta demo.';
        connect.disabled = false;
        return;
      }
    }
    const result = await chrome.runtime.sendMessage({ type });
    if (!result?.ok) throw new Error('Unavailable');
    status.textContent = result.connected ? 'Demo conectada. Puedes desconectarla en cualquier momento.' : 'Demo desconectada.';
    connect.disabled = result.connected;
    disconnect.disabled = !result.connected;
  } catch { status.textContent = 'No se pudo cambiar la conexión. Vuelve a abrir este panel.'; }
}
connect.addEventListener('click', () => void update('CONNECT_DEMO'));
disconnect.addEventListener('click', () => void update('DISCONNECT_DEMO'));
void update();
