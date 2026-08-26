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
  //    AGT002_DOCUMENT_RETRIEVAL y AGT002_LEGAL_CORPUS requieren AGT002_CONTEXT_V2, y
  //    AGT002_INTEGRAL_CONTRACT_V3 requiere AGT002_CANONICAL_ONLY + AGT002_CONTEXT_V2 +
  //    AGT002_DOCUMENT_RETRIEVAL (ver caso 4), así que cada una se activa aquí junto a su
  //    dependencia para aislar solo el parseo del literal.
  //    AGT002_DECISION_AXIS_SURFACE queda fuera de este lote a propósito: su parseo es más
  //    estricto (sólo el literal exacto 'true') y se verifica en el caso 3b.
  {
    const requiredBaseByFlag = {
      AGT002_DOCUMENT_RETRIEVAL: { AGT002_CONTEXT_V2: 'true' },
      AGT002_LEGAL_CORPUS: { AGT002_CONTEXT_V2: 'true' },
      AGT002_INTEGRAL_CONTRACT_V3: {
        AGT002_CANONICAL_ONLY: 'true',
        AGT002_CONTEXT_V2: 'true',
        AGT002_DOCUMENT_RETRIEVAL: 'true',
      },
      AGT002_RADAR_VISIBILITY: { AGT002_RADAR_GATE: 'true' },
    };
    for (const name of ANALYSIS_FLAG_NAMES) {
      if (name === 'AGT002_DECISION_AXIS_SURFACE') continue;
      const base = requiredBaseByFlag[name] || {};

      const literalTrue = buildAgt002AnalysisConfig({ ...base, [name]: 'true' });
      assert.equal(literalTrue[name], true, `${name}='true' debe habilitar`);

      const literalOne = buildAgt002AnalysisConfig({ ...base, [name]: '1' });
      assert.equal(literalOne[name], true, `${name}='1' debe habilitar`);

      const literalUpper = buildAgt002AnalysisConfig({ ...base, [name]: 'TRUE' });
      assert.equal(literalUpper[name], true, `${name}='TRUE' debe habilitar (sin distinción de mayúsculas)`);
    }
  }

  // 3b) AGT002_DECISION_AXIS_SURFACE (§17 / AC22 de la spec "Análisis para decidir"): apagada por
  //     defecto y activada EXCLUSIVAMENTE por el literal exacto 'true'. Es presentación pura, así
  //     que no exige ninguna otra bandera para encenderse.
  {
    assert.equal(
      buildAgt002AnalysisConfig({}).AGT002_DECISION_AXIS_SURFACE,
      false,
      'AGT002_DECISION_AXIS_SURFACE debe estar apagada por defecto',
    );
    for (const rawValue of ['1', 'TRUE', 'True', ' true ', 'yes', 'on', '', undefined, null, true]) {
      assert.equal(
        buildAgt002AnalysisConfig({ AGT002_DECISION_AXIS_SURFACE: rawValue }).AGT002_DECISION_AXIS_SURFACE,
        false,
        `AGT002_DECISION_AXIS_SURFACE=${JSON.stringify(rawValue)} NO debe habilitar (sólo el literal 'true')`,
      );
    }
    const enabled = buildAgt002AnalysisConfig({ AGT002_DECISION_AXIS_SURFACE: 'true' });
    assert.equal(enabled.AGT002_DECISION_AXIS_SURFACE, true, "AGT002_DECISION_AXIS_SURFACE='true' debe habilitar");
    assert.equal(enabled.AGT002_INTEGRAL_CONTRACT_V3, false, 'la superficie no arrastra ninguna otra bandera');
  }

  // 4) estados contradictorios se rechazan: retrieval o legal corpus sin context v2;
  //    integral v3 sin canonical-only, context v2 y document retrieval simultáneos.
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
    assert.throws(
      () => buildAgt002AnalysisConfig({ AGT002_INTEGRAL_CONTRACT_V3: 'true' }),
      /AGT002_CANONICAL_ONLY|AGT002_CONTEXT_V2|AGT002_DOCUMENT_RETRIEVAL/,
      'AGT002_INTEGRAL_CONTRACT_V3 sin ninguna dependencia debe rechazarse',
    );
    assert.throws(
      () => buildAgt002AnalysisConfig({
        AGT002_INTEGRAL_CONTRACT_V3: 'true',
        AGT002_CANONICAL_ONLY: 'true',
      }),
      /AGT002_CONTEXT_V2|AGT002_DOCUMENT_RETRIEVAL/,
      'AGT002_INTEGRAL_CONTRACT_V3 sólo con AGT002_CANONICAL_ONLY debe rechazarse',
    );
    assert.throws(
      () => buildAgt002AnalysisConfig({
        AGT002_INTEGRAL_CONTRACT_V3: 'true',
        AGT002_CANONICAL_ONLY: 'true',
        AGT002_CONTEXT_V2: 'true',
      }),
      /AGT002_DOCUMENT_RETRIEVAL/,
      'AGT002_INTEGRAL_CONTRACT_V3 sin AGT002_DOCUMENT_RETRIEVAL debe rechazarse',
    );
  }

  // 5) combinaciones válidas no se rechazan.
  {
    const config = buildAgt002AnalysisConfig({
      AGT002_CANONICAL_ONLY: 'true',
      AGT002_CONTEXT_V2: 'true',
      AGT002_DOCUMENT_RETRIEVAL: 'true',
      AGT002_LEGAL_CORPUS: 'true',
      AGT002_INTEGRAL_CONTRACT_V3: 'true',
    });
    assert.equal(config.AGT002_CONTEXT_V2, true);
    assert.equal(config.AGT002_DOCUMENT_RETRIEVAL, true);
    assert.equal(config.AGT002_LEGAL_CORPUS, true);
    assert.equal(config.AGT002_INTEGRAL_CONTRACT_V3, true);
  }

  // 6) ausencia de legal corpus no bloquea v3: la abstención jurídica se fuerza en el engine
  //    (fuera de alcance de este módulo), no en la configuración.
  {
    const config = buildAgt002AnalysisConfig({
      AGT002_CANONICAL_ONLY: 'true',
      AGT002_CONTEXT_V2: 'true',
      AGT002_DOCUMENT_RETRIEVAL: 'true',
      AGT002_INTEGRAL_CONTRACT_V3: 'true',
    });
    assert.equal(config.AGT002_LEGAL_CORPUS, false);
    assert.equal(config.AGT002_INTEGRAL_CONTRACT_V3, true);
  }

  // 7) el objeto resultante es inmutable.
  {
    const config = buildAgt002AnalysisConfig({});
    assert.throws(() => { config.AGT002_CONTEXT_V2 = true; }, TypeError);
  }

  // 8) sin argumento usa process.env por defecto y no explota.
  {
    assert.doesNotThrow(() => buildAgt002AnalysisConfig());
  }

  console.log('agt002-analysis-config contract passed');
}

run();
