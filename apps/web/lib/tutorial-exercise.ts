import type { TutorialField, TutorialStep } from './tutorial-catalog';

export interface TutorialExerciseError {
  fieldId: string;
  message: string;
}

/** Fixed-result exercises must use the intended filter or selection before completing. */
export function tutorialExerciseErrors(
  action: TutorialStep['action'], fields: ReadonlyArray<TutorialField>, values: Readonly<Record<string, string>>,
): TutorialExerciseError[] {
  if (action !== 'filter' && action !== 'select') return [];
  return fields.flatMap((field) => normalize(values[field.id] ?? '') === normalize(field.value) ? [] : [{
    fieldId: field.id,
    message: `En este ejercicio usa «${field.value}» en ${field.label.toLocaleLowerCase('es-MX')}.`,
  }]);
}

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().replace(/\s+/g, ' ').toLocaleLowerCase('es-MX');
}
