import { strict as assert } from 'node:assert';
import { buildAgt002AnalysisConfig, ANALYSIS_FLAG_NAMES } from '../agt002-analysis-config.js';

function run() {
  // 1) sin variables de entorno -> todas las flags en false.
  {
    const config = buildAgt002AnalysisConfig({});
    for (const name of ANALYSIS_FLAG_NAMES) {
      assert.equal(config[name], false, `${name} debe ser false por defecto`);
    }
  }

  // 2) valores mal formados no habilitan nada (fail-closed).
  {
    const malformed = {
      TENDER_IMMEDIATE_DISPATCH: 'yes',
      TENDER_CONTINUOUS_DRAIN: 'yes',
      AGT002_CANONICAL_ONLY: '0',
      AGT002_CONTEXT_V2: '',
      AGT002_DOCUMENT_RETRIEVAL: 'enabled',
      AGT002_LEGAL_CORPUS: 'on',
    };
    const config = buildAgt002AnalysisConfig(malformed);
    for (const name of ANALYSIS_FLAG_NAMES) {
      assert.equal(config[name], false, `${name} con valor mal formado debe ser false`);
    }
  }

  // 3) solo los literales soportados ('true' y '1', sin distinción de mayúsculas) habilitan.
  //    AGT002_DOCUMENT_RETRIEVAL y AGT002_LEGAL_CORPUS requieren AGT002_CONTEXT_V2 (ver caso 4),
  //    así que se activan aquí junto a esa dependencia para aislar solo el parseo del literal.
  {
    const dependsOnContextV2 = new Set(['AGT002_DOCUMENT_RETRIEVAL', 'AGT002_LEGAL_CORPUS']);
    for (const name of ANALYSIS_FLAG_NAMES) {
      const base = dependsOnContextV2.has(name) ? { AGT002_CONTEXT_V2: 'true' } : {};

      const literalTrue = buildAgt002AnalysisConfig({ ...base, [name]: 'true' });
      assert.equal(literalTrue[name], true, `${name}='true' debe habilitar`);

      const literalOne = buildAgt002AnalysisConfig({ ...base, [name]: '1' });
      assert.equal(literalOne[name], true, `${name}='1' debe habilitar`);

      const literalUpper = buildAgt002AnalysisConfig({ ...base, [name]: 'TRUE' });
      assert.equal(literalUpper[name], true, `${name}='TRUE' debe habilitar (sin distinción de mayúsculas)`);
    }
  }

  // 4) estados contradictorios se rechazan: retrieval o legal corpus sin context v2.
  {
    assert.throws(
      () => buildAgt002AnalysisConfig({ AGT002_DOCUMENT_RETRIEVAL: 'true', AGT002_CONTEXT_V2: 'false' }),
      /AGT002_CONTEXT_V2/,
      'AGT002_DOCUMENT_RETRIEVAL sin AGT002_CONTEXT_V2 debe rechazarse',
    );
    assert.throws(
      () => buildAgt002AnalysisConfig({ AGT002_LEGAL_CORPUS: 'true' }),
      /AGT002_CONTEXT_V2/,
      'AGT002_LEGAL_CORPUS sin AGT002_CONTEXT_V2 debe rechazarse',
    );
  }

  // 5) combinaciones válidas no se rechazan.
  {
    const config = buildAgt002AnalysisConfig({
      AGT002_CONTEXT_V2: 'true',
      AGT002_DOCUMENT_RETRIEVAL: 'true',
      AGT002_LEGAL_CORPUS: 'true',
    });
    assert.equal(config.AGT002_CONTEXT_V2, true);
    assert.equal(config.AGT002_DOCUMENT_RETRIEVAL, true);
    assert.equal(config.AGT002_LEGAL_CORPUS, true);
  }

  // 6) el objeto resultante es inmutable.
  {
    const config = buildAgt002AnalysisConfig({});
    assert.throws(() => { config.AGT002_CONTEXT_V2 = true; }, TypeError);
  }

  // 7) sin argumento usa process.env por defecto y no explota.
  {
    assert.doesNotThrow(() => buildAgt002AnalysisConfig());
  }

  console.log('agt002-analysis-config contract passed');
}

run();
