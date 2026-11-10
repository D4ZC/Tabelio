'use client';

import { AppShell } from '@/components/app-shell';

export default function AssistantPage() {
  return (
    <AppShell>
      <div className="assistant-page-fallback" aria-live="polite">
        <span className="eyebrow">Espacio de trabajo</span>
        <h1>Tabelio IA</h1>
        <p>Preparando la conversación en pantalla completa…</p>
      </div>
    </AppShell>
  );
}
