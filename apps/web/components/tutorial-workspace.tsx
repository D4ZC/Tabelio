'use client';

import { forwardRef, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { TutorialChapter, TutorialField, TutorialStep } from '@/lib/tutorial-catalog';
import { tutorialExerciseErrors, type TutorialExerciseError } from '@/lib/tutorial-exercise';
import './tutorial-workspace.css';

export interface TutorialWorkspaceProps {
  chapter: TutorialChapter;
  step: TutorialStep;
  mode: 'demo' | 'practice';
  onAction: (stepId: string) => void;
  completedActions?: string[];
}

type WorkspaceArea = 'search' | 'directory' | 'matters' | 'documents' | 'extractions' | 'insights' | 'contracts' | 'tasks' | 'notifications' | 'portal' | 'reports' | 'requirements' | 'clauses' | 'team' | 'audit' | 'pilot' | 'launch' | 'account' | 'assistant';

const areaNames: Record<WorkspaceArea, string> = {
  search: 'Buscar', directory: 'Directorio', matters: 'Expedientes', documents: 'Documentos',
  extractions: 'Extracciones', insights: 'Análisis del expediente', contracts: 'Contrato y seguimiento',
  tasks: 'Tareas', notifications: 'Avisos', portal: 'Portal del cliente', reports: 'Reportes',
  requirements: 'Requisitos', clauses: 'Cláusulas', team: 'Equipo', audit: 'Auditoría',
  pilot: 'Preparar piloto', launch: 'Lanzamiento', account: 'Mi cuenta', assistant: 'Tabelio IA',
};

const actionNames: Record<TutorialStep['action'], string> = {
  inspect: 'Consultar', open: 'Abrir', fill: 'Capturar', confirm: 'Revisar y confirmar',
  filter: 'Filtrar', select: 'Seleccionar', download: 'Preparar archivo de ejemplo',
};

/** The tutorial owns this workspace. It never renders live records or sends network requests. */
export const TutorialWorkspace = forwardRef<HTMLDivElement, TutorialWorkspaceProps>(function TutorialWorkspace({ chapter, step, mode, onAction }, ref) {
  const fieldPrefix = useId();
  const form = useRef<HTMLFormElement>(null);
  const [appliedStep, setAppliedStep] = useState<string | null>(null);
  const [resultValues, setResultValues] = useState<Array<{ label: string; value: string }>>([]);
  const [exerciseErrors, setExerciseErrors] = useState<TutorialExerciseError[]>([]);
  const area = workspaceArea(chapter);
  const applied = appliedStep === step.id;
  const exerciseKey = `${step.id}:${mode}`;
  const asksForInput = ['fill', 'filter', 'select'].includes(step.action);

  useEffect(() => {
    setAppliedStep(null);
    setResultValues([]);
    setExerciseErrors([]);
  }, [exerciseKey]);

  function performAction(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (mode === 'practice' && form.current && !form.current.reportValidity()) return;
    const values = form.current ? new FormData(form.current) : undefined;
    const errors = mode === 'practice' ? tutorialExerciseErrors(step.action, step.fields ?? [],
      Object.fromEntries((step.fields ?? []).map((field) => [field.id, String(values?.get(field.id) ?? '')]))) : [];
    setExerciseErrors(errors);
    if (errors.length) {
      const control = form.current?.elements.namedItem(errors[0].fieldId);
      if (control instanceof HTMLElement) control.focus();
      return;
    }
    setResultValues((step.fields ?? []).map((field) => ({ label: field.label, value: String(values?.get(field.id) ?? field.value) })));
    setAppliedStep(step.id);
    onAction(step.id);
  }

  return <div className="tutorial-workspace" ref={ref} aria-label="Aplicación de práctica con datos ficticios">
    <div className="tutorial-workspace-safe-banner"><span aria-hidden="true">◈</span><strong>Entorno de práctica</strong><span>Datos ficticios · sin IA ni envíos reales</span></div>
    <div className="tutorial-workspace-window">
      <aside className="tutorial-workspace-nav" aria-label="Ubicación de la pantalla de práctica">
        <div className="tutorial-workspace-brand"><span>T</span><div><strong>Tabelio</strong><small>Legal inmobiliario</small></div></div>
        <div className="tutorial-workspace-navigation-label">Pantalla de ejemplo</div>
        {(['search', 'assistant', 'matters', 'documents', 'tasks', 'directory', 'reports'] as WorkspaceArea[]).map((item) => <span key={item} className={navigationGroup(area) === item ? 'is-current' : ''} aria-current={navigationGroup(area) === item ? 'page' : undefined}><span aria-hidden="true">{item === 'assistant' ? '✦' : item === 'directory' ? '◉' : item === 'tasks' ? '✓' : item === 'reports' ? '▥' : item === 'search' ? '⌕' : '▤'}</span>{areaNames[item]}</span>)}
        {!['search', 'assistant', 'matters', 'documents', 'tasks', 'directory', 'reports'].includes(navigationGroup(area)) && <span className="is-current" aria-current="page"><span aria-hidden="true">{chapter.icon}</span>{areaNames[area]}</span>}
        <div className="tutorial-workspace-person"><span>PD</span><div><strong>Persona Demo</strong><small>Despacho de práctica</small></div></div>
      </aside>
      <section className="tutorial-workspace-content" aria-label={`Pantalla de práctica: ${areaNames[area]}`}>
        <header className="tutorial-workspace-header"><div><span className="tutorial-workspace-eyebrow">{chapter.title}</span><h2>{areaNames[area]}</h2><p>{areaDescription(area)}</p></div><span className="tutorial-workspace-example-tag">Ejemplo interactivo</span></header>
        <WorkspaceContext area={area} applied={applied} />
        <section className={`tutorial-workspace-action-card ${applied ? 'is-applied' : ''}`} aria-label={`Practicar: ${step.title}`}>
          <div className="tutorial-workspace-action-header"><div><span className="tutorial-workspace-action-type">{actionNames[step.action]}</span><h3>{step.title}</h3></div><span className="tutorial-workspace-action-number" aria-hidden="true">{applied ? '✓' : '↗'}</span></div>
          <p className="tutorial-workspace-instruction">{step.instruction}</p>
          <form key={exerciseKey} ref={form} onSubmit={performAction} className="tutorial-workspace-form">
            {Boolean(step.fields?.length) && <div className="tutorial-workspace-fields">{step.fields!.map((field) => <WorkspaceField key={field.id} field={field} id={`${fieldPrefix}-${field.id}`} empty={mode === 'practice' && asksForInput} error={exerciseErrors.find((item) => item.fieldId === field.id)?.message} />)}</div>}
            {exerciseErrors.length > 0 && <p className="tutorial-workspace-validation" role="alert">Revisa los valores indicados para completar este ejercicio.</p>}
            {step.preview && step.preview.length > 0 && <dl className="tutorial-workspace-preview">{step.preview.map((item, index) => <div key={`${item.label}-${index}`}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>}
            {step.action === 'confirm' && <label className="tutorial-workspace-review"><input name="reviewed" type="checkbox" required={mode === 'practice'} defaultChecked={mode === 'demo'} /><span>Revisé los datos de este ejemplo y quiero continuar con la práctica.</span></label>}
            <div className="tutorial-workspace-action-footer"><button
              type="button"
              className="tutorial-workspace-primary-action"
              data-tutorial-target={step.target}
              data-tutorial-action={step.id}
              data-tutorial-demo-safe="true"
              onClick={() => performAction()}
            >{step.buttonLabel}<span aria-hidden="true">{step.action === 'download' ? '↓' : step.action === 'confirm' ? '✓' : '→'}</span></button><small>{mode === 'demo' ? 'El recorrido hará este clic por ti.' : asksForInput && step.fields?.length ? 'Completa los campos con los datos de ejemplo y pulsa el botón.' : 'Haz clic para probar esta función.'}</small></div>
          </form>
          {applied && <div className="tutorial-workspace-result" role="status" aria-live="polite"><div className="tutorial-workspace-result-icon" aria-hidden="true">✓</div><div><strong>{resultHeading(step.action)}</strong><p>Resultado esperado del ejemplo: {step.result}</p>{resultValues.length > 0 && <dl>{resultValues.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value || 'Sin especificar'}</dd></div>)}</dl>}<small>Resultado de práctica. Tus expedientes y tu presupuesto no se han modificado.</small></div></div>}
        </section>
        <footer className="tutorial-workspace-footer"><span aria-hidden="true">◌</span>Estás aprendiendo en una copia de demostración. Al salir volverás a tu aplicación.</footer>
      </section>
    </div>
  </div>;
});

function WorkspaceField({ field, id, empty, error }: { field: TutorialField; id: string; empty: boolean; error?: string }) {
  const value = empty ? '' : field.value;
  const errorAttributes = { 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? `${id}-error` : undefined };
  return <label htmlFor={id} className={field.type === 'textarea' ? 'tutorial-workspace-field-full' : undefined}><span>{field.label}</span>{field.type === 'select'
    ? <select id={id} name={field.id} defaultValue={value} required {...errorAttributes}><option value="" disabled>Selecciona una opción</option>{[...new Set([...(field.options ?? []), field.value])].filter(Boolean).map((option) => <option value={option} key={option}>{option}</option>)}</select>
    : field.type === 'textarea'
      ? <textarea id={id} name={field.id} rows={3} defaultValue={value} placeholder={field.value} required maxLength={1000} {...errorAttributes} />
      : <input id={id} name={field.id} type={field.type === 'date' ? 'date' : 'text'} defaultValue={value} placeholder={field.value} required maxLength={200} autoComplete="off" {...errorAttributes} />}{error && <span className="tutorial-workspace-field-error" id={`${id}-error`}>{error}</span>}</label>;
}

function workspaceArea(chapter: TutorialChapter): WorkspaceArea {
  const areas: Record<string, WorkspaceArea> = {
    welcome: 'matters', search: 'search', directory: 'directory', matters: 'matters',
    documents: 'documents', reading: 'extractions', extractions: 'extractions', insights: 'insights',
    contracts: 'contracts', clauses: 'clauses', review: 'contracts', signature: 'contracts', lifecycle: 'contracts',
    tasks: 'tasks', notifications: 'notifications', portal: 'portal', reports: 'reports', requirements: 'requirements',
    team: 'team', audit: 'audit', pilot: 'pilot', launch: 'launch', assistant: 'assistant', account: 'account',
  };
  return areas[chapter.id] ?? 'matters';
}

function navigationGroup(area: WorkspaceArea): WorkspaceArea {
  if (['contracts', 'insights', 'portal'].includes(area)) return 'matters';
  if (area === 'extractions') return 'documents';
  if (area === 'notifications') return 'tasks';
  return area;
}

function areaDescription(area: WorkspaceArea) {
  const descriptions: Record<WorkspaceArea, string> = {
    search: 'Encuentra personas, inmuebles, documentos y expedientes desde un solo lugar.',
    directory: 'Captura una vez y reutiliza personas e inmuebles en todos los asuntos.',
    matters: 'Todas las piezas del expediente, con requisitos, responsables y seguimiento.',
    documents: 'Versiones, vigencias y lectura documental con revisión humana.',
    extractions: 'Compara la lectura con el original antes de confirmar sus datos.',
    insights: 'Comprende los datos y sus fuentes con análisis local o con IA.',
    contracts: 'Prepara el contrato y conserva el historial de cada revisión.',
    tasks: 'Organiza responsables, fechas, evidencias y trabajo pendiente.',
    notifications: 'Revisa lo que necesita tu atención y reconoce los avisos resueltos.',
    portal: 'Solicita información al cliente y revisa su entrega antes de incorporarla.',
    reports: 'Consulta productividad, tiempos, cargas y próximos vencimientos.',
    requirements: 'Define qué necesita cada expediente y cómo debe acreditarse.',
    clauses: 'Reutiliza textos jurídicos aprobados con versiones controladas.',
    team: 'Administra integrantes y el acceso que requiere cada función.',
    audit: 'Consulta quién hizo cada cambio y cuándo ocurrió.',
    pilot: 'Comprueba que las personas y los procesos estén listos para operar.',
    launch: 'Revisa la aceptación y las compuertas de un despliegue gradual.',
    account: 'Mantén tus datos de acceso y seguridad actualizados.',
    assistant: 'Consulta, prepara acciones y controla el consumo de IA.',
  };
  return descriptions[area];
}

function resultHeading(action: TutorialStep['action']) {
  return action === 'download' ? 'Vista previa del archivo de ejemplo' : action === 'filter' ? 'Resultados filtrados en la práctica' : action === 'confirm' ? 'Confirmación completada en la práctica' : action === 'fill' ? 'Datos de ejemplo preparados' : action === 'select' ? 'Selección aplicada al ejemplo' : 'Así se muestra el resultado';
}

function WorkspaceContext({ area, applied }: { area: WorkspaceArea; applied: boolean }) {
  if (area === 'assistant') return <div className="tutorial-workspace-assistant-context">
    <div className="tutorial-workspace-budget"><div><span>Mi presupuesto</span><strong>500.00 <small>Advantage Credits</small></strong><small>Saldo ficticio para este recorrido</small></div><div><span>Este chat</span><strong>0.000120 USD</strong><small>Ejemplo de costo estimado</small></div><div><span>Última operación</span><strong>Lectura de ejemplo</strong><small>Sin llamadas de IA en este tutorial</small></div><div><span>Mi consumo · aplicación</span><strong>0.003420 USD</strong><small>Importes ficticios</small></div></div>
    <div className="tutorial-workspace-message"><span>✦</span><p>Puedo ayudarte a localizar el expediente de ejemplo, revisar sus pendientes o preparar una acción para tu confirmación.</p></div>
  </div>;
  if (area === 'reports' || area === 'pilot' || area === 'launch') return <div className="tutorial-workspace-metrics"><article><span>{area === 'reports' ? 'Expedientes activos' : 'Comprobaciones completadas'}</span><strong>{area === 'reports' ? '12' : '4 de 5'}</strong><small>Datos de ejemplo</small></article><article><span>{area === 'reports' ? 'Revisión promedio' : 'Pendientes de revisión'}</span><strong>{area === 'reports' ? '2.4 días' : '1'}</strong><small>{area === 'reports' ? 'Periodo seleccionado' : 'Consulta los puntos por resolver'}</small></article><article><span>{area === 'reports' ? 'Tareas en plazo' : 'Estado de preparación'}</span><strong>{area === 'reports' ? '92%' : 'En revisión'}</strong><small>Panel de práctica</small></article></div>;
  if (area === 'extractions' || area === 'documents') return <div className="tutorial-workspace-document-context"><div className="tutorial-workspace-paper"><span>DOCUMENTO DE EJEMPLO</span><strong>Comprobante de domicilio</strong><p>Persona de práctica<br />Calle Ejemplo 120<br />Guadalajara, Jalisco</p><div /><div /><small>Archivo ficticio para aprender</small></div><div className="tutorial-workspace-document-list"><strong>Archivos del expediente</strong><div><span className="tutorial-workspace-file">PDF</span><span>Identificación ejemplo.pdf<small>Pendiente de revisión</small></span><b>v1</b></div><div><span className="tutorial-workspace-file">PDF</span><span>Comprobante ejemplo.pdf<small>{applied ? 'Acción de práctica completada' : 'Lectura local disponible'}</small></span><b>v1</b></div></div></div>;
  if (area === 'contracts' || area === 'clauses') return <div className="tutorial-workspace-contract-context"><div><span className="tutorial-workspace-example-tag">Borrador · v2</span><h3>Contrato de arrendamiento</h3><p>Casa Alameda · expediente de ejemplo</p><div className="tutorial-workspace-contract-copy">PRIMERA. Objeto del contrato.<br />Las partes de este ejemplo acuerdan el arrendamiento del inmueble descrito en el expediente.<br /><br />SEGUNDA. Condiciones económicas.<br />Renta mensual de ejemplo: $12,000 MXN.</div></div><ol><li className="is-done">Integración documental</li><li className="is-current">Revisión jurídica</li><li>Aprobación final</li><li>Firma y activación</li></ol></div>;
  if (area === 'tasks' || area === 'notifications') return <div className="tutorial-workspace-table"><div className="tutorial-workspace-table-heading"><span>{area === 'tasks' ? 'Trabajo pendiente' : 'Bandeja personal'}</span><small>Expediente de ejemplo</small></div>{[['Revisar identificación', 'Persona Demo', applied ? 'En curso' : 'Por hacer'], ['Preparar borrador del contrato', 'Abogado Demo', 'En curso'], ['Confirmar entrega del cliente', 'Operador Demo', 'Pendiente']].map(([title, person, status]) => <div className="tutorial-workspace-table-row" key={title}><span className="tutorial-workspace-row-icon">{area === 'tasks' ? '✓' : '!'}</span><span><strong>{title}</strong><small>Casa Alameda · {person}</small></span><span className="tutorial-workspace-status">{status}</span></div>)}</div>;
  if (area === 'directory' || area === 'team') return <div className="tutorial-workspace-people">{[['PD', 'Persona Demo', area === 'team' ? 'Administración' : 'Persona física'], ['AD', 'Abogado Demo', area === 'team' ? 'Jurídico' : 'Persona física'], ['OD', 'Operador Demo', area === 'team' ? 'Operación' : 'Persona física']].map(([initials, name, type]) => <article key={name}><span>{initials}</span><div><strong>{name}</strong><small>{type} · ejemplo</small></div></article>)}</div>;
  if (area === 'account') return <div className="tutorial-workspace-profile"><span>PD</span><div><strong>Persona Demo</strong><small>persona@ejemplo.invalid</small><small>Despacho de práctica · cuenta ficticia</small></div><b>Sesión de ejemplo</b></div>;
  if (area === 'requirements') return <div className="tutorial-workspace-table"><div className="tutorial-workspace-table-heading"><span>Checklist del expediente</span><small>2 de 3 acreditados · ejemplo</small></div>{[['Identificación del arrendador', 'Cumplido'], ['Comprobante de domicilio', 'Cumplido'], ['Documento del inmueble', 'Pendiente']].map(([label, status]) => <div className="tutorial-workspace-table-row" key={label}><span className="tutorial-workspace-row-icon">{status === 'Cumplido' ? '✓' : '○'}</span><strong>{label}</strong><span className="tutorial-workspace-status">{status}</span></div>)}</div>;
  if (area === 'audit') return <div className="tutorial-workspace-table"><div className="tutorial-workspace-table-heading"><span>Historial del expediente de ejemplo</span><small>Hoy · datos ficticios</small></div>{[['09:42', 'Documento revisado', 'Persona Demo'], ['09:35', 'Borrador v2 generado', 'Abogado Demo'], ['09:12', 'Expediente creado', 'Operador Demo']].map(([time, label, name]) => <div className="tutorial-workspace-table-row" key={time}><span className="tutorial-workspace-audit-time">{time}</span><span><strong>{label}</strong><small>{name}</small></span><span className="tutorial-workspace-status">Ejemplo</span></div>)}</div>;
  if (area === 'portal') return <div className="tutorial-workspace-portal"><span>⇄</span><div><h3>Entrega del cliente</h3><p>Captura y archivos de ejemplo separados del expediente hasta su revisión.</p><div><span>Datos personales</span><b>Por revisar</b></div><div><span>Identificación ejemplo.pdf</span><b>Recibido</b></div></div></div>;
  if (area === 'insights') return <div className="tutorial-workspace-insights"><div><span className="tutorial-workspace-example-tag">Sin IA · reglas locales</span><h3>Resumen de Casa Alameda</h3><p>Expediente en integración con tres participantes, dos documentos y un requisito pendiente.</p><small>Fuentes: ficha del expediente · checklist · inventario documental</small></div><div><strong>1 punto por revisar</strong><p>Falta el documento del inmueble para completar el requisito.</p><small>Hallazgo de ejemplo para revisión humana.</small></div></div>;
  return <div className="tutorial-workspace-table"><div className="tutorial-workspace-table-heading"><span>{area === 'search' ? 'Resultados de ejemplo' : 'Expedientes del despacho'}</span><small>Todos los registros son ficticios</small></div>{[['DEMO-001', 'Arrendamiento Casa Alameda', applied ? 'Acción revisada' : 'En integración'], ['DEMO-002', 'Convenio de ejemplo', 'Borrador']].map(([reference, title, status]) => <div className="tutorial-workspace-table-row" key={reference}><span className="tutorial-workspace-row-icon">▤</span><span><small>{reference}</small><strong>{title}</strong></span><span className="tutorial-workspace-status">{status}</span></div>)}</div>;
}
