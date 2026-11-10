const baseUrl = new URL(process.env.DEMO_API_URL ?? 'http://127.0.0.1:4000/api/');
if (!['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname)) {
  throw new Error('La preparación de la demo sólo puede ejecutarse contra una API local.');
}
if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';
let accessToken;

async function request(path, method = 'GET', body) {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}

function deadline(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(18, 0, 0, 0);
  return date.toISOString();
}

async function main() {
  const login = await request('auth/login', 'POST', {
    email: 'admin@demo.local',
    password: process.env.DEMO_PASSWORD ?? 'Demo123!',
    organizationSlug: 'demo-despacho',
  });
  accessToken = login.accessToken;
  const assignees = await request('tasks/assignees');
  const membership = assignees.find((entry) => entry.user.email === 'admin@demo.local');
  if (!membership) throw new Error('No se encontró el responsable de la organización demo.');
  const matters = await request('matters');
  const scenarios = [
    { title: 'DEMO IA - Arrendamiento Alameda', tasks: [
      { title: 'DEMO IA - Revisar identificación del arrendatario', priority: 'NORMAL', days: -2 },
      { title: 'DEMO IA - Preparar borrador del contrato', priority: 'HIGH', days: 2, status: 'IN_PROGRESS' },
    ] },
    { title: 'DEMO IA - Arrendamiento Chapultepec', tasks: [
      { title: 'DEMO IA - Validar documento de propiedad', priority: 'URGENT', days: -1 },
      { title: 'DEMO IA - Coordinar revisión de condiciones', priority: 'NORMAL', days: 5 },
    ] },
    { title: 'DEMO IA - Arrendamiento Providencia', tasks: [
      { title: 'DEMO IA - Programar firma del contrato', priority: 'LOW', days: 14 },
      { title: 'DEMO IA - Recabar datos del obligado solidario', priority: 'NORMAL' },
    ] },
  ];
  for (const scenario of scenarios) {
    const matter = matters.find((entry) => entry.title === scenario.title)
      ?? await request('matters', 'POST', { title: scenario.title, kind: 'LEASE' });
    const existingTasks = await request(`tasks?matterId=${encodeURIComponent(matter.id)}`);
    for (const fixture of scenario.tasks) {
      const dueAt = fixture.days === undefined ? undefined : deadline(fixture.days);
      let task = existingTasks.find((entry) => entry.title === fixture.title);
      if (!task) {
        task = await request(`matters/${matter.id}/tasks`, 'POST', {
          title: fixture.title, priority: fixture.priority, dueAt,
          assigneeMembershipId: membership.id,
        });
        if (fixture.status) {
          await request(`tasks/${task.id}/status`, 'POST', { status: fixture.status });
        }
      } else {
        if (['DONE', 'CANCELLED'].includes(task.status)) {
          await request(`tasks/${task.id}/status`, 'POST', { status: 'TODO' });
          task.status = 'TODO';
        }
        await request(`tasks/${task.id}`, 'PATCH', {
          priority: fixture.priority, assigneeMembershipId: membership.id,
        });
        if (dueAt && task.dueAt !== dueAt) {
          await request(`tasks/${task.id}/reschedule`, 'POST', {
            dueAt, reason: 'Actualizar las fechas relativas de los datos ficticios de demostración.',
          });
        }
        if (fixture.status === 'IN_PROGRESS' && task.status !== 'IN_PROGRESS') {
          await request(`tasks/${task.id}/status`, 'POST', { status: 'IN_PROGRESS' });
        }
      }
    }
    console.info(`${matter.reference}: ${scenario.title} (${scenario.tasks.length} tareas)`);
  }
  console.info('Demo lista: 3 expedientes y 6 tareas, con vencidas, en plazo y sin fecha límite. No se eliminó ningún registro.');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
