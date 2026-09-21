import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mergeCommercialOwnerOptions } from "../src/vigia/owner-options.js";

const options = mergeCommercialOwnerOptions(
  [{ id: "juan", full_name: "Juan Botero" }],
  [
    { owner_id: "jhon", owner_name: "Jhon Bermudez" },
    { owner_id: "juan", owner_name: "Nombre desactualizado" },
  ],
);
assert.deepEqual(options, [["jhon", "Jhon Bermudez"], ["juan", "Juan Botero"]], "includes eligible owners without priorities and prefers the canonical profile label");

const main = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
const component = readFileSync(new URL("../src/vigia/VigiaCommercial.tsx", import.meta.url), "utf8");
assert.match(main, /commercialOwners=\{data\.profiles\.filter\(isCommercialProfile\)/, "router passes every eligible commercial profile to Vigia");
assert.match(component, /mergeCommercialOwnerOptions\(commercialOwners, priorities\)/, "Vigia merges profile owners with owners present in priorities");
console.log("Vigia commercial owner options passed");
