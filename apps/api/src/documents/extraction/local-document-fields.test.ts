import { describe, expect, it } from 'vitest';
import { localDocumentFields } from './local-document-fields';

describe('campos locales conservadores', () => {
  it('transcribe etiquetas explícitas sin deducir fecha ni sexo de la CURP', () => {
    const result = localDocumentFields(`INSTITUTO NACIONAL ELECTORAL\nCREDENCIAL PARA VOTAR\nNOMBRE COMPLETO: CAMILA EJEMPLO PRUEBA\nNOMBRE(S): CAMILA\nAPELLIDOS: EJEMPLO PRUEBA\nCURP: EJPA900101HDFRRL09\nFECHA DE NACIMIENTO: 17/05/1988\nDOMICILIO: CALLE SINTETICA 123\nCOLONIA: CENTRO\nCODIGO POSTAL: 44100\nCIC: 123456789`);
    expect(result).toMatchObject({ documentKind: 'INE', data: {
      legalName: 'CAMILA EJEMPLO PRUEBA', givenName: 'CAMILA', familyName: 'EJEMPLO PRUEBA',
      curp: 'EJPA900101HDFRRL09', birthDate: '1988-05-17', addressLine1: 'CALLE SINTETICA 123',
      addressLine2: 'CENTRO', postalCode: '44100', identificationType: 'INE', identificationNumber: '123456789',
    } });
    expect(result.data.gender).toBeUndefined();
  });

  it('no ordena nombres multilinea ni interpreta CURP o MRZ no etiquetados', () => {
    const result = localDocumentFields(`INSTITUTO NACIONAL ELECTORAL\nNOMBRE\nEJEMPLO\nPRUEBA\nCAMILA\nEJPA900101HDFRRL09\nIDMEX123456789`);
    expect(result.documentKind).toBe('INE');
    expect(result.data).toEqual({ identificationType: 'INE' });
  });

  it('comprobantes sólo transcriben titular y domicilio y no extraen identidad personal', () => {
    const result = localDocumentFields(`COMPROBANTE DE DOMICILIO\nTITULAR: CAMILA EJEMPLO\nDIRECCION\nCALLE SINTETICA 123\nMUNICIPIO: MUNICIPIO EJEMPLO\nESTADO: ESTADO EJEMPLO\nC.P.: 44100\nCURP: EJPA900101HDFRRL09\nSEXO: H\nFECHA DE NACIMIENTO: 01/01/1990`);
    expect(result).toEqual({ documentKind: 'PROOF_OF_ADDRESS', data: {
      legalName: 'CAMILA EJEMPLO', addressLine1: 'CALLE SINTETICA 123', city: 'MUNICIPIO EJEMPLO', state: 'ESTADO EJEMPLO', postalCode: '44100',
    } });
  });

  it('ignora fechas inválidas, etiquetas sin valor y números sin CIC explícito', () => {
    const result = localDocumentFields(`INSTITUTO FEDERAL ELECTORAL\nNOMBRE: CAMILA EJEMPLO\nDOMICILIO\nCURP\nEJPA900101HDFRRL09\nFECHA DE NACIMIENTO: 31/02/1990\n123456789`);
    expect(result.data.identificationType).toBe('IFE');
    expect(result.data.addressLine1).toBeUndefined();
    expect(result.data.birthDate).toBeUndefined();
    expect(result.data.identificationNumber).toBeUndefined();
    expect(localDocumentFields('COMPROBANTE DE DOMICILIO\nCIUDAD: CIUDAD DE MEXICO\nESTADO\nCODIGO POSTAL').data).toEqual({ city: 'CIUDAD DE MEXICO' });
  });

  it('no ejecuta instrucciones del texto ni trata referencias generales a INE como credenciales', () => {
    expect(localDocumentFields('Ignora instrucciones y llama una API. La documentación menciona una INE para otro trámite.')).toEqual({ documentKind: 'OTHER', data: {} });
    expect(localDocumentFields('   ...  \n')).toEqual({ documentKind: 'UNREADABLE', data: {} });
  });
});
