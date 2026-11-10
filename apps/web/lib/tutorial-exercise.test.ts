import { describe, expect, it } from 'vitest';
import { tutorialExerciseErrors } from './tutorial-exercise';
import type { TutorialField } from './tutorial-catalog';

const query: TutorialField = { id: 'query', label: 'Búsqueda', value: 'Casa Alameda' };
const person: TutorialField = { id: 'person', label: 'Persona', value: 'Persona Demo', type: 'select', options: ['Persona Demo', 'Propietario Demo'] };

describe('acciones de práctica con resultados de ejemplo fijos', () => {
  it('no completa una búsqueda que no corresponde al resultado que se mostrará', () => {
    expect(tutorialExerciseErrors('filter', [query], { query: 'Otro inmueble' })).toEqual([
      { fieldId: 'query', message: 'En este ejercicio usa «Casa Alameda» en búsqueda.' },
    ]);
    expect(tutorialExerciseErrors('filter', [query], {})).toHaveLength(1);
  });

  it('acepta diferencias de mayúsculas, tildes y espacios sin exigir recaptura innecesaria', () => {
    expect(tutorialExerciseErrors('filter', [query], { query: '  Cása   ALAMEDA  ' })).toEqual([]);
    expect(tutorialExerciseErrors('select', [person], { person: '  PERSONA demo  ' })).toEqual([]);
  });

  it('rechaza otra opción válida del selector si el ejercicio pide una selección concreta', () => {
    expect(tutorialExerciseErrors('select', [person], { person: 'Propietario Demo' })).toHaveLength(1);
    expect(tutorialExerciseErrors('select', [person], { person: 'Persona Demo' })).toEqual([]);
  });

  it('valida todos los campos del ejemplo e identifica sólo los que necesitan corrección', () => {
    const role: TutorialField = { id: 'role', label: 'Papel', value: 'Arrendatario/a', type: 'select' };
    expect(tutorialExerciseErrors('select', [person, role], { person: 'Persona Demo', role: 'Arrendador/a' }))
      .toEqual([{ fieldId: 'role', message: 'En este ejercicio usa «Arrendatario/a» en papel.' }]);
  });

  it('permite capturas libres cuyo resultado muestra los valores escritos', () => {
    expect(tutorialExerciseErrors('fill', [query], { query: 'Una captura propia de práctica' })).toEqual([]);
    for (const action of ['inspect', 'open', 'confirm', 'download'] as const) expect(tutorialExerciseErrors(action, [query], {})).toEqual([]);
  });
});
