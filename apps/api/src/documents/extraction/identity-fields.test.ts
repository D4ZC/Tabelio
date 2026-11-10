import { describe, expect, it } from 'vitest';
import { identityData, identityPersonChanges, identityPersonValue } from './identity-fields';

describe('campos de una identificación', () => {
  it('conserva sólo campos permitidos, normaliza la CURP y omite datos vacíos', () => {
    expect(identityData({
      givenName: '  Persona de prueba  ',
      curp: 'demo900101hdfxxx09',
      familyName: null,
      city: '  ',
      state: '',
      organizationId: 'otra-organizacion',
      notes: 'No se debe aplicar',
    })).toEqual({ givenName: 'Persona de prueba', curp: 'DEMO900101HDFXXX09' });
  });

  it.each([null, [], 'texto', 12])('rechaza datos que no son un objeto: %j', (value) => {
    expect(() => identityData(value)).toThrow('deben ser un objeto');
  });

  it.each([
    { birthDate: '2026-02-29' },
    { birthDate: '2024-02-30' },
    { birthDate: '29/10/1990' },
    { birthDate: '1990-01-01T00:00:00Z' },
    { curp: 'INCOMPLETA' },
    { givenName: 123 },
    { givenName: 'x'.repeat(301) },
  ])('rechaza fechas, CURP o textos inválidos: %j', (data) => {
    expect(() => identityData(data)).toThrow();
  });

  it('admite una fecha real sin inferir otros campos', () => {
    expect(identityData({ birthDate: '2000-02-29' })).toEqual({ birthDate: '2000-02-29' });
    expect(identityData({ curp: 'DEMO900101HDFXXX09' })).not.toHaveProperty('birthDate');
  });

  it('normaliza los valores actuales de la ficha para compararlos', () => {
    expect(identityPersonValue(null)).toBe('');
    expect(identityPersonValue(undefined)).toBe('');
    expect(identityPersonValue('  Nombre actual  ')).toBe('Nombre actual');
    expect(identityPersonValue(new Date('1990-01-01T00:00:00Z'))).toBe('1990-01-01');
  });
});

describe('aplicación explícita a la ficha', () => {
  it('sólo actualiza campos seleccionados y convierte la fecha a Date', () => {
    const changes = identityPersonChanges({
      data: { givenName: 'Prueba', birthDate: '1990-01-01', city: 'Ciudad visible' },
      fields: ['givenName', 'birthDate'],
      person: { givenName: null, birthDate: null },
      expectedValues: { givenName: '', birthDate: '' },
    });
    expect(changes).toEqual({ givenName: 'Prueba', birthDate: new Date('1990-01-01T00:00:00Z') });
    expect(changes).not.toHaveProperty('city');
  });

  it('no hace cambios si no se seleccionaron campos o los valores son iguales', () => {
    expect(identityPersonChanges({ data: { givenName: 'Prueba' }, fields: [], person: {} })).toEqual({});
    expect(identityPersonChanges({
      data: { givenName: 'Prueba' }, fields: ['givenName'], person: { givenName: 'Prueba' },
    })).toEqual({});
  });

  it.each(['organizationId', 'notes', 'unknown', 'city'])('no aplica campos arbitrarios o sin datos: %s', (field) => {
    expect(() => identityPersonChanges({
      data: { givenName: 'Prueba', organizationId: 'otra-organizacion' }, fields: [field], person: {},
    })).toThrow('únicamente campos de identificación');
  });

  it('no reemplaza datos existentes sin autorización y valor anterior conocido', () => {
    const options = { data: { legalName: 'Nombre nuevo' }, fields: ['legalName'], person: { legalName: 'Nombre anterior' } };
    expect(() => identityPersonChanges(options)).toThrow('Confirma expresamente');
    expect(() => identityPersonChanges({ ...options, overwriteFields: ['legalName'] })).toThrow('Confirma expresamente');
    expect(() => identityPersonChanges({ ...options, expectedValues: { legalName: 'Nombre anterior' } })).toThrow('Confirma expresamente');
    expect(identityPersonChanges({
      ...options, overwriteFields: ['legalName'], expectedValues: { legalName: 'Nombre anterior' },
    })).toEqual({ legalName: 'Nombre nuevo' });
  });

  it('rechaza una ficha que cambió desde la revisión, incluso si el campo ahora está vacío', () => {
    expect(() => identityPersonChanges({
      data: { legalName: 'Nombre nuevo' }, fields: ['legalName'], overwriteFields: ['legalName'],
      person: { legalName: 'Otro nombre' }, expectedValues: { legalName: 'Nombre anterior' },
    })).toThrow('La ficha cambió');
    expect(() => identityPersonChanges({
      data: { givenName: 'Nombre nuevo' }, fields: ['givenName'],
      person: { givenName: null }, expectedValues: { givenName: 'Nombre anterior' },
    })).toThrow('La ficha cambió');
  });
});
