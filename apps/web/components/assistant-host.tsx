'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AiAssistant } from '@/components/ai-assistant';
import { apiFetch } from '@/lib/api';

interface AssistantIdentity {
  id: string;
  organization: {
    id: string;
  };
}

export function AssistantHost() {
  const pathname = usePathname();
  const enabledForRoute = !isPublicRoute(pathname) && pathname !== '/tutorial';
  const [identity, setIdentity] = useState<AssistantIdentity>();

  useEffect(() => {
    if (!enabledForRoute) {
      setIdentity(undefined);
      return;
    }

    let active = true;
    const loadIdentity = () => {
      void apiFetch<AssistantIdentity>('/auth/me')
        .then((current) => {
          if (active) setIdentity(current);
        })
        .catch(() => {
          if (active) setIdentity(undefined);
        });
    };
    const refreshVisibleIdentity = () => {
      if (document.visibilityState === 'visible') loadIdentity();
    };
    loadIdentity();
    window.addEventListener('focus', loadIdentity);
    document.addEventListener('visibilitychange', refreshVisibleIdentity);
    return () => {
      active = false;
      window.removeEventListener('focus', loadIdentity);
      document.removeEventListener('visibilitychange', refreshVisibleIdentity);
    };
  }, [enabledForRoute]);

  if (!enabledForRoute || !identity?.id || !identity.organization?.id) return null;
  const identityKey = `${identity.organization.id}:${identity.id}`;
  return (
    <AiAssistant
      key={identityKey}
      userId={identity.id}
      organizationId={identity.organization.id}
    />
  );
}

function isPublicRoute(pathname: string) {
  return pathname === '/login'
    || pathname === '/recuperar'
    || pathname === '/restablecer'
    || pathname === '/portal'
    || pathname.startsWith('/portal/');
}
