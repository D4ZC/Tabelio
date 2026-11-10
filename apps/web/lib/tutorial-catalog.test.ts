import { describe, expect, it } from 'vitest';
import { chaptersForRole, isTutorialRole, stepsForRole, TUTORIAL_CATALOG_VERSION, tutorialChapters, tutorialSteps } from './tutorial-catalog';

describe('catálogo del tutorial para clientes', () => {
  it('cubre módulos de la aplicación con objetivos y destinos de práctica únicos', () => {
    expect(TUTORIAL_CATALOG_VERSION).toBeGreaterThan(0);
    expect(tutorialChapters.length).toBeGreaterThanOrEqual(20);
    expect(new Set(tutorialChapters.map((chapter) => chapter.title)).size).toBe(tutorialChapters.length);
    expect(tutorialSteps.length).toBeGreaterThanOrEqual(90);
    expect(tutorialSteps.length).toBeLessThanOrEqual(125);
    expect(new Set(tutorialSteps.map((step) => step.id)).size).toBe(tutorialSteps.length);
    expect(new Set(tutorialSteps.map((step) => step.target)).size).toBe(tutorialSteps.length);
    const expected = ['search', 'directory', 'matters', 'documents', 'reading', 'extractions', 'insights', 'contracts', 'clauses', 'review', 'signature', 'lifecycle', 'tasks', 'notifications', 'portal', 'reports', 'requirements', 'team', 'audit', 'pilot', 'launch', 'assistant', 'account'];
    expect(tutorialChapters.map((chapter) => chapter.id)).toEqual(expect.arrayContaining(expected));
    for (const chapter of tutorialChapters) {
      expect(chapter.steps.length).toBeGreaterThan(0);
      for (const step of chapter.steps) {
        expect(step.chapterId).toBe(chapter.id);
        expect(step.target).toBe(`tutorial-${step.id}`);
        expect(step.explanation.length).toBeGreaterThan(50);
        expect(step.instruction.trim()).not.toBe('');
        expect(step.result.trim()).not.toBe('');
        expect(step.buttonLabel.trim()).not.toBe('');
        expect(step.durationSeconds).toBeGreaterThanOrEqual(8);
        expect(step.durationSeconds).toBeLessThanOrEqual(20);
        for (const field of step.fields ?? []) {
          expect(field.id).toMatch(/^[a-z-]+$/);
          if (field.type === 'select') expect(field.options).toContain(field.value);
        }
      }
    }
  });

  it('sólo publica rutas estáticas de entrada sin API, destinos externos ni enlaces privados', () => {
    const safeRoutes = new Set(['/expedientes', '/buscar', '/directorio', '/documentos', '/extracciones', '/clausulas', '/tareas', '/avisos', '/reportes', '/requisitos', '/equipo', '/auditoria', '/piloto', '/lanzamiento', '/asistente', '/cuenta']);
    expect(tutorialSteps.every((step) => safeRoutes.has(step.route))).toBe(true);
    expect(tutorialSteps.some((step) => /https?:|\/api\b|\/portal\/|\?|#/.test(step.route))).toBe(false);
  });

  it('reserva escritura, aprobaciones y administración a los perfiles correspondientes', () => {
    const viewer = stepsForRole('VIEWER').map((step) => step.id);
    const operator = stepsForRole('OPERATOR').map((step) => step.id);
    const lawyer = stepsForRole('LAWYER').map((step) => step.id);
    for (const id of ['directory-person', 'matters-create', 'documents-invalidate', 'documents-delete', 'extractions-apply', 'insights-use-suggestion', 'tasks-create', 'portal-accept', 'assistant-write-confirmation']) expect(viewer).not.toContain(id);
    for (const id of ['contracts-generate', 'review-legal', 'signature-register', 'lifecycle-create-renewal']) expect(operator).not.toContain(id);
    for (const id of ['clauses-approve', 'review-final', 'requirements-create', 'team-create', 'pilot-rollout', 'launch-decision']) expect(lawyer).not.toContain(id);
    expect(chaptersForRole('VIEWER').some((chapter) => ['clauses', 'audit', 'pilot', 'launch', 'team', 'requirements'].includes(chapter.id))).toBe(false);
    expect(stepsForRole('ADMIN')).toEqual(tutorialSteps);
    expect(stepsForRole('desconocido')).toEqual(stepsForRole('VIEWER'));
    expect(isTutorialRole('ADMIN')).toBe(true);
    expect(isTutorialRole('admin')).toBe(false);
    expect(isTutorialRole(null)).toBe(false);
  });

  it('filtra sobre copias sin alterar el catálogo que puede recorrerse con otro perfil', () => {
    const before = tutorialSteps.length;
    const viewer = chaptersForRole('VIEWER');
    viewer[0].steps.pop();
    expect(tutorialChapters[0].steps).toHaveLength(3);
    expect(stepsForRole('ADMIN')).toHaveLength(before);
  });

  it('reserva la puesta en marcha completa al administrador, incluso los pasos de consulta', () => {
    for (const role of ['LAWYER', 'OPERATOR', 'VIEWER', 'desconocido', null, undefined]) {
      expect(chaptersForRole(role).some((chapter) => ['pilot', 'launch'].includes(chapter.id))).toBe(false);
      expect(stepsForRole(role).some((step) => ['/piloto', '/lanzamiento'].includes(step.route))).toBe(false);
    }
    const startup = chaptersForRole('ADMIN').filter((chapter) => ['pilot', 'launch'].includes(chapter.id));
    expect(startup.map((chapter) => chapter.title)).toEqual(['Prueba inicial', 'Puesta en marcha: revisión y aprobación']);
    expect(startup.every((chapter) => chapter.roles?.length === 1 && chapter.roles[0] === 'ADMIN')).toBe(true);
    expect(startup.flatMap((chapter) => chapter.steps).map((step) => step.id)).toEqual(
      tutorialSteps.filter((step) => ['pilot', 'launch'].includes(step.chapterId)).map((step) => step.id),
    );
  });
});
