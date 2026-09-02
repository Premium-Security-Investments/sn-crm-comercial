begin;

-- AGT-002 governed SharePoint company-evidence catalog (catálogo histórico adjudicado).
--
-- Inventory, never copy: SharePoint remains the source of truth for the files themselves, so
-- this migration persists only opaque metadata about each observed source file — a content
-- fingerprint, a revision fingerprint, its governance disposition/state and two timestamps.
-- No human-readable locator (name, folder, URL, item identifier) and no personal data is ever
-- stored here, which is what keeps the catalog safe to fingerprint, diff and expose as a
-- snapshot.
--
-- Two internal detail relations back a single safe read path:
--   * psi_agt002_company_evidence_source_files — one row per observed source file;
--   * psi_agt002_company_evidence_source_file_links — the N:M curation of those files onto
--     the human-approved 17-class evidence registry (061, version-forwarded to
--     v0.3.1-approved-20260829 by 075), keyed by the registry's own versioned
--     (entry_id, version) identity so a later manifest revision can never silently re-point
--     an existing link.
--
-- Both relations have RLS enabled and NO privileges for any role, including service_role:
-- every read goes through public.psi_get_agt002_company_evidence_inventory_snapshot(), a
-- SECURITY DEFINER function that returns aggregate counts only. The registry itself is only
-- ever read (through a foreign key); this migration never updates, deletes from or otherwise
-- rewrites the human-approved manifest, and it promotes nothing: a file being present and
-- linked is an observation, never a statement that the class is current, verified or
-- applicable to a given case.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Opaque source-file inventory. `source_fingerprint` is the stable identity of the observed
-- file's content and `source_revision` the fingerprint of the revision it was observed at:
-- a corrected or re-uploaded file changes them, which is what makes catalog_snapshot_hash a
-- real staleness signal rather than a count of rows.
create table if not exists public.psi_agt002_company_evidence_source_files (
  id uuid primary key default gen_random_uuid(),
  source_fingerprint text not null unique
    constraint psi_agt002_company_evidence_source_files_fp_sha256
    check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  source_revision text not null
    constraint psi_agt002_company_evidence_source_files_rev_sha256
    check (source_revision ~ '^[0-9a-f]{64}$'),
  disposition text not null
    constraint psi_agt002_company_evidence_source_files_disposition
    check (disposition in ('evidence', 'excluded_non_evidence')),
  -- Closed governance vocabulary, in catalog order. Nullable, because a row excluded as
  -- non-evidence is deliberately left ungoverned rather than forced into a state.
  governed_state text
    constraint psi_agt002_company_evidence_source_files_governed_state
    check (governed_state in (
      'current_valid',
      'historical_update_required',
      'reported_unverified',
      'absent_unknown',
      'process_specific_template'
    )),
  last_modified_at timestamptz not null,
  observed_at timestamptz not null,
  -- An evidence row is always governed; an excluded row never is.
  constraint psi_agt002_company_evidence_source_files_disposition_state check (
    (disposition = 'evidence' and governed_state is not null)
    or (disposition = 'excluded_non_evidence' and governed_state is null)
  )
);

alter table public.psi_agt002_company_evidence_source_files enable row level security;
revoke all on table public.psi_agt002_company_evidence_source_files from public;
revoke all on table public.psi_agt002_company_evidence_source_files from anon;
revoke all on table public.psi_agt002_company_evidence_source_files from authenticated;
revoke all on table public.psi_agt002_company_evidence_source_files from service_role;

-- N:M curation onto the governed registry. The foreign key targets (entry_id, version) — the
-- registry's own versioned identity — and restricts on delete/update so a linked manifest row
-- can never be removed or re-versioned out from under the catalog.
create table if not exists public.psi_agt002_company_evidence_source_file_links (
  id uuid primary key default gen_random_uuid(),
  source_file_id uuid not null
    references public.psi_agt002_company_evidence_source_files (id) on delete cascade,
  entry_id text not null,
  entry_version integer not null,
  constraint psi_agt002_company_evidence_source_file_links_registry_fk
    foreign key (entry_id, entry_version)
    references public.psi_agt002_company_evidence_registry (entry_id, version)
    on delete restrict on update restrict,
  constraint psi_agt002_company_evidence_source_file_links_unique_link
    unique (source_file_id, entry_id, entry_version)
);

alter table public.psi_agt002_company_evidence_source_file_links enable row level security;
revoke all on table public.psi_agt002_company_evidence_source_file_links from public;
revoke all on table public.psi_agt002_company_evidence_source_file_links from anon;
revoke all on table public.psi_agt002_company_evidence_source_file_links from authenticated;
revoke all on table public.psi_agt002_company_evidence_source_file_links from service_role;

-- Reviewed seed: the 93 source rows of the adjudicated historical folder (92 evidence + 1
-- excluded as non-evidence), with the classes each evidence row was curated onto. Nothing is
-- current_valid: this is a historical folder, and 25 rows require an update, 50 are reported
-- but unverified, and 17 are process-specific templates rather than company evidence of a
-- class's currency.
--
-- One statement, one seed list: the source rows are inserted first, then every link resolves
-- its source_file_id either from that insert (first apply) or from the rows already present
-- (re-apply, where ON CONFLICT DO NOTHING returns nothing), so apply/apply converges instead
-- of duplicating. Links join the registry through its CURRENT v0.3.1-approved rows, so a
-- superseded version can never be linked.
with seed (source_fingerprint, source_revision, disposition, governed_state, last_modified_at, entry_ids) as (
  values
    ('1793a4173071c31fcc1bb7e8fad77892f86838b07f7c24aa539f6cb54f51659d'::text, '20ea957796cc4c4ee5c8a5a7330e4674f6f1fa99221d0d72894a5cf1fb850cfd'::text, 'evidence'::text, 'process_specific_template'::text, '2026-07-30T21:34:13Z'::timestamptz, array['differential_scoring_support']::text[]),
    ('1c9759c7a452e68c5f6090afc9b2d07127f29f237c431927148ca0d812f34b9c', 'fa1927edfa8a049e5b9475da6828621ca1aae1f72e5ad362aae2dd56d9c3d653', 'evidence', 'reported_unverified', '2026-07-30T21:34:27Z', array['personnel_credentials_vault']),
    ('4fb3e5106075344cf662e5e91577f319e5c67a49a69950e6c00eb9b989996d57', '144583f2e34979aca4f44daf6adc428348f8b0e58b649aec91e5ac034f259a77', 'evidence', 'reported_unverified', '2026-07-30T21:34:41Z', array['legal_representative_vault']),
    ('2bd0b6a8ec25d2ba375789a6f16cd60b671bf387ed7d08664edf33a0b95fcdea', 'ae7055748ee565e74ed2305159d4cc44166594441ca5cbd1eec0ae89decbfa55', 'evidence', 'process_specific_template', '2026-07-30T21:34:35Z', array['differential_scoring_support']),
    ('c67dccf9e9cfbc8f94cf30fd516bf78036d1f888bc69287e01fe7dc4de2f32c1', 'ced3150fd67c749b73cb0a6628dfbd83a252a46cf4c72c1a53f0913ea9d0ef54', 'evidence', 'historical_update_required', '2026-07-30T21:33:17Z', array['financial_and_tax_pack']),
    ('046a503324a06dfa45dd3275a3763a57b7606e7238075335dbb139cec4012757', '4cb675ba53364a458da296ee69cfbad730e0979654637af178575faa17bb8cbf', 'evidence', 'reported_unverified', '2026-07-30T21:32:08Z', array['personnel_credentials_vault']),
    ('0c1d2c1bc867122cc96f74a94654ab15d96bb83c4105737be7a1b7167039d8cf', 'd3e1fecbf55817baa4f86281db9fba476f5d433adb8265f8bdc60107b1923ae9', 'evidence', 'process_specific_template', '2026-07-30T21:33:35Z', array['differential_scoring_support']),
    ('6c6fc0a627d6e097038bdc39d4b051475797eddd3b7793661e142eb42ee5e838', 'c593b8e04822d724f515cbd2e2cba53e24a77740e61b48df8ec55345083ce5ae', 'evidence', 'historical_update_required', '2026-07-30T21:33:50Z', array['uniforms_resolution']),
    ('b25aea356465661e262fc6c0bee80d1e78c15e6e237f289161efd1e27496a825', '9729a3ebfe673513c8e0f25bcebe40e87130b5561eef9851d2cd87c89311b612', 'evidence', 'reported_unverified', '2026-07-30T21:34:44Z', array['corporate_background_checks']),
    ('d1379e9e37670529b9fb0e2b6755c91e4a9ca8d46069dbb38a161f8eeac6e6c3', 'd82f03fb18fc7b6601be4f5b1140e95d3c80dd8e59306842d5dfcbf2f4b7ad1c', 'evidence', 'reported_unverified', '2026-07-30T21:34:42Z', array['legal_representative_vault']),
    ('b6c96b058e1f9c4b8a78c1bc318de6e7a6084df362f96041ef5e18f425d1fccb', '3f77642766ebbff77d89968085dc19eee33631eefa8abd8d5cc3662caca723bd', 'evidence', 'reported_unverified', '2026-07-30T21:34:21Z', array['legal_representative_vault']),
    ('b858da90b7952641a820ad418f7c78d2946f465620a0cd2bbd14296785267bf5', '6234dcdad0d2e101d1a94f3a1a6bb527f00e8de74561833d014d3267c52d011a', 'evidence', 'reported_unverified', '2026-07-30T21:32:13Z', array['personnel_credentials_vault']),
    ('58e59ec2dd7eea683bc7d2a2b461a133b3e465185cf4ff4dcf528344c46d08d5', 'fb048158198f70e292613ec442ee7317d0705838737f82246aac624eb01d10ba', 'evidence', 'reported_unverified', '2026-07-30T21:34:44Z', array['legal_representative_vault']),
    ('1de128cf86f84eb24a8de3676e99c71cfcf6fed6aa538a23ed6cdbd1f69d6de7', 'c0a0ca0e8b7226700e5c6156212d54746f56ebcd80d78be017bcf83f025b0623', 'evidence', 'reported_unverified', '2026-07-30T21:33:18Z', array['personnel_credentials_vault']),
    ('34154a5e3c21a1119ec7b4ba241cc0fadbee20315c01e79ef714b2df7db6fcb5', 'de42db22afa4ae26be26f8518d63f3dc32f1c3088a7cc0377065a2bc59646bc9', 'evidence', 'reported_unverified', '2026-07-30T21:32:45Z', array['personnel_credentials_vault']),
    ('34a9ba29b299c3023a7d032ca010b0a19470466a59f6608517dbd8c3663cb870', 'd30570877a744b214a4e3fddfa3a10315e40b725e67b25eff614e0333ad99b17', 'evidence', 'historical_update_required', '2026-07-30T21:33:52Z', array['accredited_experience']),
    ('03c0632cac8324d75432f2854d57cb1c93223bd2ee48cbbc179d29f466624e2f', '990d7566ce34fb81e66efe8a9aa3a6d4dba875fc40c809c7dd83d41f22f27217', 'evidence', 'reported_unverified', '2026-07-30T21:32:28Z', array['personnel_credentials_vault']),
    ('0f67c9b17f7cdaf037c523006319eee9bcd9beae16d82db05c8fff30bb8611e7', 'dfe34a0e8300ccf47e518fd7b403d4f7ecfa255d2df02b202a6a134201f4ed0d', 'evidence', 'historical_update_required', '2026-07-30T21:32:11Z', array['authorized_weapons_list']),
    ('7c650b78adeb33a87e3daa80d3c202654c6f571e7ae2c0ea3c8bfbd0ef2023fd', '426907f0cd89944d9b8505ce4bfe3f638c1d9e5ae755b52ecfcab7026d6779e7', 'evidence', 'reported_unverified', '2026-07-30T21:33:13Z', array['personnel_credentials_vault']),
    ('935138c76b011e595abb36dc84e78423f8dc4843ef0f1b890f794122aa90e7e1', 'ecd41136dece0a73519f1c846902ef5981144d8436251d8007377cb14d0cf1c2', 'evidence', 'historical_update_required', '2026-07-30T21:33:17Z', array['supervigilancia_operating_license']),
    ('665c7bb23767ea69932cc9d5d44d7d9879b219559486a0f5af9bcb048282f0c6', '2ebf27f817ade8a4959432ce44b1fef958f4789fa4ac14bdaf68122831d82217', 'evidence', 'reported_unverified', '2026-07-30T21:32:40Z', array['personnel_credentials_vault']),
    ('c405360227f349e19ece9708caf73d7bcad0fab33a6c4d85b13875ae6c24a140', 'aa543c6bb3acb0f3f389c5402fa04cce8c7c3bca982c56c029723a07cbd7e1e8', 'evidence', 'historical_update_required', '2026-07-30T21:33:08Z', array['supervigilancia_operating_license']),
    ('8180dec196ebb5d633517d25ce073a79e821a42ac0f325c0f06702328cfe1d18', 'e916e71ab648fd3d4a1398ecd3c3439f6b82934d1fec8e4773b6ac4f56122649', 'evidence', 'process_specific_template', '2026-07-30T21:32:14Z', array['differential_scoring_support']),
    ('4604be6de56a4243ed9c68727bea2481a2c205f0a6228b8e1781d47c261a3b63', 'c5697fc7b5a137da943a1435bee220384002e341d1566f5f8c074de226446352', 'evidence', 'reported_unverified', '2026-07-30T21:34:41Z', array['legal_representative_vault']),
    ('340918d909deefcf09e13d7a0b73eaa4da488290c33f686786fa46fe0281a9ea', '0878d1c79484f9056134049613819ee810f3a640397f5175fd2b94d83d2e4058', 'evidence', 'historical_update_required', '2026-07-30T21:32:10Z', array['authorized_weapons_list']),
    ('c2292474ed65ac62a2af99b4cb09e461bf1b122f2dac1570764b86202dc8ef62', 'ee56d0e75a9669c1a270ccb166264cd998346ee1bd91e0a41ea399810d5d525b', 'evidence', 'reported_unverified', '2026-07-30T21:33:37Z', array['personnel_credentials_vault']),
    ('651bba670da56526a5fc04ceb9f25a930c5d42cb74ece4ef69c11a696e10de54', '51e62214b1d26fa87bf30abc55ef01f90bbab04e8675c849fb01600a95b84de1', 'evidence', 'reported_unverified', '2026-07-30T21:33:15Z', array['personnel_credentials_vault']),
    ('34bbe13575e8aed9e24454f8bfec716ab872adff2d64049728ad88858307eb17', '8affaba1ed2473d5495c6983f0a09f70d33f408e25182972f2e833f5ca267ac7', 'evidence', 'historical_update_required', '2026-07-30T21:32:25Z', array['bank_certificate']),
    ('c94076fb07d49b7153c2af40bebc0ab059e43e8a9785b70475db08e74a6d2e58', '892ec9c3950ced239bde15bb909ce95875ebfc76baec8f74c8e26e8d02f3c664', 'evidence', 'reported_unverified', '2026-07-30T21:34:39Z', array['legal_representative_vault']),
    ('ee9b1694f93020ef4285f6aadbdd4b19e7172c66cc33bd224a7c5fbda514e940', 'dd3c67561bb66cbbd89fed617e991c7bf6aec267abf686b777e18f38474ba29a', 'evidence', 'historical_update_required', '2026-07-30T21:34:26Z', array['no_fines_sanctions_certificate']),
    ('a025aeddc7634608216a3d40b85a5c087a48d3d14ed00749e4c6fa502a378dd6', 'ce320d6ff299b5fe4b06f35cb980ccfc4684e4297e2112a274552ff8e1415b81', 'evidence', 'reported_unverified', '2026-07-30T21:34:47Z', array['personnel_credentials_vault']),
    ('f0d9255cb864f755094965a9da463cb62b216d4c79cd40cd7b19a0244f29e3cb', '0bb50c250b43bb18bf7d8a3e882432c5f7cb225dade6901265aa931d0115e45e', 'evidence', 'reported_unverified', '2026-07-30T21:33:51Z', array['personnel_credentials_vault']),
    ('667aa055f031dbc6216c1ae804090fcba4b05390018701a0d8cbdf49afea8f86', '244641eb88e8d22bb6e3e2561f81573c6116e909cb38a532c189df6b97eb1994', 'evidence', 'process_specific_template', '2026-07-30T21:34:29Z', array['differential_scoring_support']),
    ('1cb8fb6ca6ff6dc3d80a76a30a4ba710c29f7347d80e7b63370c85ab538db547', '48ac8f2ee787656821eb975e51344725235cf50e574dcb240748e7d363824c6f', 'evidence', 'reported_unverified', '2026-07-30T21:34:35Z', array['personnel_credentials_vault']),
    ('c065ac580946ea2d1a57bea0affc9611bb629fec399961df575561d994372280', 'bc1f3d055d0c2dc8bbcef594db29f0b0e0d9eca12f8c3c4c7380ef0c4f2b2766', 'evidence', 'historical_update_required', '2026-07-30T21:33:49Z', array['communications_license']),
    -- The single row adjudicated as non-evidence: catalogued for completeness of the folder,
    -- deliberately ungoverned and linked to no class.
    ('cb28f53913aa6ffee2dddf5c613af3a9f8fceead3f20dea04008c7ea95af9108', 'dc871400d4c52091b3bd3166b842dde5419903811e936aa6ff4379ab495e4c47', 'excluded_non_evidence', null, '2026-07-30T21:32:14Z', array[]::text[]),
    ('82ee16fbb13577c088194171a8f21bb1d96c0f7489395639d0514571dd7aaca5', '58c62693f6d688c624e59bb72572f44ea9b4319cad978370691e110657e12ded', 'evidence', 'historical_update_required', '2026-07-30T21:33:21Z', array['communications_license']),
    ('009a79679a887c249dfc6181cb15e2cb3615b908dcce96d526bf0a492aef2b06', 'f6b395970a53099cc74cffe92dacb6bb4dcb430efbe27dc974272972b8fc7562', 'evidence', 'reported_unverified', '2026-07-30T21:33:14Z', array['personnel_credentials_vault']),
    ('2c6e95265efd6f777637e0fda3b84cdc28e44520514b35f0de41ae75b80210ce', '0db5860cadf96644f19ba602042250c657a807d2ab0c1b9c78ffa36e09cd8b7f', 'evidence', 'reported_unverified', '2026-07-30T21:33:15Z', array['personnel_credentials_vault']),
    ('0fc255b33c3ca0d57dd3555b9fc233c4ae0e898d00fc2ef5cdc37f1d76cbdc52', '267153c9007f4200e0ca1075880598bfc7e3e2f78036dbd2c133f215469613b3', 'evidence', 'reported_unverified', '2026-07-30T21:32:48Z', array['personnel_credentials_vault']),
    ('88cb4dcd226038255d9a4d5bde3d321e25dabecc059e7ef9d5c3c65db91afdbe', 'eb319bd29a55d1c180279d20c7514348b0a76aef0729e76b72406a73842b9eb6', 'evidence', 'historical_update_required', '2026-07-30T21:34:20Z', array['rup']),
    ('81f24aeaf5e0c1bfdc8a2b5b22cbd2f5213ef555b8e5d627999b7dcfe58d0b37', '68e7ff1b4c8110c053e60dffa86cc3cb25485ba513af8431c23c6813e359f3fd', 'evidence', 'reported_unverified', '2026-07-30T21:33:16Z', array['personnel_credentials_vault']),
    ('041d1e66768795258b837e2edc6c300af411d78c8e9acb0414c979fe9b009a4b', '4dd6242efaf0d477d2affd5d791c0ca1bbea3a4066403ff1936a9690487f1876', 'evidence', 'reported_unverified', '2026-07-30T21:34:03Z', array['personnel_credentials_vault']),
    ('2c8b88d27fc168ef978101999ebb0b96028c911ffb071980fa03b3e8e79490fe', 'd6f8808709ab592e4d4fb99a1fb81aa215b1636c509b930ed9a3d306d7cf1598', 'evidence', 'reported_unverified', '2026-07-30T21:34:41Z', array['legal_representative_vault']),
    ('48bb7a0ad853a8c850bf27c80834e008203879eabcce17d3c256eaaa9a780ef1', '2286ba7b8be9b3f30d3326a04ca7d15571c2d2278a27352dd126c645c72fc7b9', 'evidence', 'process_specific_template', '2026-07-30T21:34:37Z', array['differential_scoring_support']),
    ('557e365a045b07c17388abf4d4c4be594e79cd89b31db69da274fac79e6bd47f', 'e869aa2037b24ce93132bcfe4f013070bd92f0da0f55cc78ea9ac654c7193118', 'evidence', 'process_specific_template', '2026-07-30T21:34:23Z', array['differential_scoring_support']),
    ('4e5b75fd0f715c6718e466ab0f67ca4512f2c4358a33375d1e6abba03a33c49f', 'a75e2c9c231a52afddc57e10893c2ddca8a223c51acb292ca53dc233f768f747', 'evidence', 'historical_update_required', '2026-07-30T21:32:23Z', array['bank_certificate']),
    ('e792366a7a428e529e967d4ebdb4c0a1cdd6baae5318d4ea8a1867c9635dae9d', '54c28e70c425441f69ffffd974355ece78efef537e234cadc2273c41a0194a77', 'evidence', 'historical_update_required', '2026-07-30T21:33:23Z', array['collective_life_policy']),
    ('45b2185adfd59c1eb8a512df9e842dc3ccaaaf309f9e4b6517692d5fe3993e10', '88d156e207751e982ffad5ab1be75a84b4b0fc588631bd07fa0107aa177c3464', 'evidence', 'reported_unverified', '2026-07-30T21:34:47Z', array['personnel_credentials_vault']),
    ('c5a7eec16348e0dfe9b9b2a88b40e6262605727cff2c20a0feb3d37e101bb2bf', '798888883155edb463f502779b2d797486d39c6f2b3d3a76f604d87384d3b2bf', 'evidence', 'process_specific_template', '2026-07-30T21:32:08Z', array['differential_scoring_support']),
    ('79b9be142a53a18348077b7c5ced0546268d2cfae3d9c557d8e139e005a0d252', 'e45f3420a26abb5a60be4ed2ef30a6b77e26dbec285d7edf1d9e682c61b7513d', 'evidence', 'historical_update_required', '2026-07-30T21:32:14Z', array['rut']),
    ('98794b141e578685746a368c3963c9da3bccce4f475b0e7b482a7a16f0bebffc', 'd8d181c2ffa9300ba446652c6efa91dd31897eba2a353fffd0e69612e9b7dea3', 'evidence', 'reported_unverified', '2026-07-30T21:33:13Z', array['personnel_credentials_vault']),
    ('8b906c82ec4383c22d812d5b332e8278f085736babb74bdd47c1c3955a942db6', '9a95b561970b78e9b5b99a1d3f4a8d940fe1c57c47cd81370a2226b14c96ccba', 'evidence', 'reported_unverified', '2026-07-30T21:34:42Z', array['corporate_background_checks']),
    ('b9f8cc9a605d98cb75ba854263602caceb8001f0620c883f8cf77bfd675b99ad', 'f6eb31fcafdcdfa207a05198c9b91fd90cafff0647691d05ffe0a4f7e0ed52f9', 'evidence', 'reported_unverified', '2026-07-30T21:32:11Z', array['personnel_credentials_vault']),
    ('f4188258f524ead03ff9ed2b5934a770242cec3e1bfdefba921753bc6eb9b271', '669bfe680c698a43ba6736851e5e8f91306f6767c69f2413abde236244c9956d', 'evidence', 'reported_unverified', '2026-07-30T21:34:20Z', array['legal_representative_vault']),
    ('504e0debf692feb98f8007cb5e9c002730ec92cf747b617860e2aff3972c76b7', '2b3793fdb24eacacbd2a87dd5cbccac2a50a48d0e2729586c76e8874491163cf', 'evidence', 'historical_update_required', '2026-07-30T21:34:03Z', array['rup']),
    ('1a171b90ecc2038a5fc2795ae72a28e8456dbc4cca12811b3da4c4ee46cde262', '1624659b903da2fcf5e74ff49db8d144c68ad7f5e71bcbf3fb28127c35ee61cf', 'evidence', 'historical_update_required', '2026-07-30T21:33:50Z', array['rup']),
    ('fa795a5c815099c4555cb6031594bf0688e5c66205d46be2231a3a2bd750abff', '4703e5be380ec61f95512adde69c8f09a5d937736e26fd260811dd3a82e04618', 'evidence', 'historical_update_required', '2026-07-30T21:32:49Z', array['overtime_authorization']),
    ('c4c7e1c457597fff09e6554066afb9aa1619bb65f57a41fb146a9f6d994e038d', '4ada45720ce9962cc23e0462d0c9f72a9444fff8054210ac190f2b63fbe1a398', 'evidence', 'historical_update_required', '2026-07-30T21:32:29Z', array['rut']),
    ('3825ea18aaca9695d4e7c82739d7adde7598a8fef28bfb6715525be58e8d7cf2', '3d320aaeb0f982411781562b38752844585368ab2e51025a0d59f08e544ec97d', 'evidence', 'reported_unverified', '2026-07-30T21:32:10Z', array['personnel_credentials_vault']),
    ('8f64a36aeb74dc6727c17faae72431ea5d013433ee321cdff552406acf80d3e8', '2aded52d316cb91d60de1f1da4f69dc7f41ddb3f58189bd2ef882309e4fa9370', 'evidence', 'reported_unverified', '2026-07-30T21:32:48Z', array['legal_representative_vault']),
    ('8c3a4b2f7f7d74b23c745a8ee2baf0a7db77db17d140385ce27b324ed961f368', 'c2ab8cbcab2280ef9d63ad7e4e2391606d53c338086119bbf1d02c9abcd96d8d', 'evidence', 'process_specific_template', '2026-07-30T21:32:39Z', array['differential_scoring_support']),
    ('deb6331f944dd02446733d758a937638a7a8402a0b04010f4737dbb59fb26c40', '0370a25333a91cc37f96a89c13fa2045f54aef0b93b1c9d48c51acbea6b7b69b', 'evidence', 'process_specific_template', '2026-07-30T21:34:24Z', array['differential_scoring_support']),
    ('98a59af458d05b7d19eec1484f8154f7510d8322980e1a6edb92d992458a3135', '01223893736ec2fa927c6bd0bc4ea08db55d575974d39bdb396a8ab336652a0e', 'evidence', 'reported_unverified', '2026-07-30T21:34:15Z', array['personnel_credentials_vault']),
    ('265e20e08c34026bffa2b1b06a2cc9324ceec16e0ad23bc2a54ffe2b51501b6b', 'c6d9ab45692638061ad0a7d9ae095befd0c14cc7531ae6c14ebe883d5952ddf8', 'evidence', 'historical_update_required', '2026-07-30T21:34:24Z', array['rup']),
    ('5f9f55c98dafcb848f1c365db7a82eb392406a9e3248b348a90951ffde118a6a', '5848853698b2bd80aa0d7831de2d9689a754e4e391eaa0b3b0c169b88bae5b86', 'evidence', 'historical_update_required', '2026-07-30T21:32:47Z', array['rce_policy']),
    ('face1b5bb5a0e5d30c8d2e730f110c2399592c0983a2490b033ebd3f6be52f92', '42d0fa1c419b9030f9beefef702138fd51b6217fe93fdbf08f48a8edad0759b8', 'evidence', 'reported_unverified', '2026-07-30T21:32:10Z', array['personnel_credentials_vault']),
    ('f411779e9aff37b8b98c05ae6a159c4a37bae11c59734165afc9352b629322fb', '99df577a6d1c6b6a97f238e0657f7142a720b07afeaecb62728bdc574860f052', 'evidence', 'process_specific_template', '2026-07-30T21:33:14Z', array['differential_scoring_support']),
    ('de9195da00a040ee0c574a6c0f2f239a2de524e7eaf579e29a0e69ef44f0615b', 'e58ede7c23bfc7e9cd183aab17b945fd0e1f4f14a1a3b032ad8703322783b65e', 'evidence', 'reported_unverified', '2026-07-30T21:34:22Z', array['personnel_credentials_vault']),
    ('45713e114ff60ae2c4b8f3fad521236fd21cbfd7c9309d37a9a91995988af24e', '51fb5b686c101ef5f08fe43e0d28c8ff0317f1bbc7d518db04f46721b2b14e3b', 'evidence', 'process_specific_template', '2026-07-30T21:32:24Z', array['differential_scoring_support']),
    ('63fb50dac6ebff26ce22be47235058f98aac467074093e094f376b3ed1db751c', '9db5776103fc7db5388d9c22f448e20dc581cb5917c7928cc9fbfc0bc2dc7cda', 'evidence', 'reported_unverified', '2026-07-30T21:34:44Z', array['corporate_background_checks']),
    ('87e8c623ccb2a9eabba69992c1e60a21efda860132f33bb998e027043d0c3762', '85e3617f72bd00c9c1bea28b7683346cf79fa4662cbdef686221aa502bdfead6', 'evidence', 'process_specific_template', '2026-07-30T21:34:38Z', array['differential_scoring_support']),
    ('01314fdce2c6d040f74f11e4eec0b29e48544d1a4fd5ab41683210dcfbbf6010', '8ab7645a938089b8d4f6074c9b3555b63e601934b28c81ad39c6a970b2ca0159', 'evidence', 'reported_unverified', '2026-07-30T21:33:54Z', array['personnel_credentials_vault']),
    ('0a17195eeffb8161a394801fda6496b852e860c4b33ebab64cbb67abdbf26fbd', 'ea7e0d5736f728e4d84e47164d39ade0854808906747e4b8dd2b1752a35e036b', 'evidence', 'historical_update_required', '2026-07-30T21:33:34Z', array['rup']),
    ('96b0fe84d3f54327e5412610fa0f97afb05b4cd7a8a4b3f8cccf6759007b77df', '90258f32e48b289f3a8dec131c7d29dcb7315b1a5a667e2258986752bd9c69eb', 'evidence', 'reported_unverified', '2026-07-30T21:34:04Z', array['personnel_credentials_vault']),
    ('bde2f2a8ebde33654290bf45849e62cfaa85fb677bb384b709368fcc7fad95a3', 'ad2945b010a6360c77df3b96b11c6ea083f56f7d317ff47028e8420167b88ec4', 'evidence', 'process_specific_template', '2026-07-30T21:33:13Z', array['differential_scoring_support']),
    ('57582ea239ba814d37386b34a8c3ac59d6e79087228bd48a2bf551a163ee5dab', 'e113aeb91b6121c0d9e428939a5718b03dcdbde16757c118bb4d446c01350d24', 'evidence', 'reported_unverified', '2026-07-30T21:33:49Z', array['personnel_credentials_vault']),
    ('7eef25b861bf2b2b2da4969e6a85a66069cf9b937db3b55e4569cecdb1714337', 'f9fc914591656b46e72a5748a5054cef6b4a3c9ce127ad352fe48e8bc762f793', 'evidence', 'reported_unverified', '2026-07-30T21:34:19Z', array['legal_representative_vault']),
    ('a5efe7fccd8dcd5548d49c1e57d7f5838d8b0d6febec61e965618ff4b4da783a', '532be13680d06e309bf1484a5820a48bbb386a0267928da90e2f8b2db09c9f24', 'evidence', 'process_specific_template', '2026-07-30T21:34:21Z', array['differential_scoring_support']),
    ('747b9458ee104b3d98e87efe6be0062f5c17c1ddbfa98e160fff340d80a5ca37', '965f5f6f9f4d01205586b60dc78b2ee8ce43cb6b1e5b2d727d7e9bf211d244b8', 'evidence', 'reported_unverified', '2026-07-30T21:34:38Z', array['personnel_credentials_vault']),
    ('93152056c625daaeab955ccc8c7f55bdf98593f7cf3c69dff84f48e0737ae146', '6c08292e37d83ed600e97bd71848db3469bb9793449a10fd3223f50ac84c2f22', 'evidence', 'reported_unverified', '2026-07-30T21:34:38Z', array['personnel_credentials_vault']),
    ('cc7dcac247726d701f1d5d58babe96066ad5fc9a00226eef6faed04ef4414dbb', '2bb0838880480f0db4099674cc7fe07ac1b8826814f1d081f3d0b89cfeabacb0', 'evidence', 'reported_unverified', '2026-07-30T21:33:15Z', array['personnel_credentials_vault']),
    ('a1605d6a2b9df5e5e4f379fa6db20415d39c3977dee5414b30b6fb840bbba9b1', '9d7732e1c8a2f8e72fd57df803f26c2541123c933177565a57ff746aa6b8902b', 'evidence', 'reported_unverified', '2026-07-30T21:33:51Z', array['personnel_credentials_vault']),
    ('6fe99e00582ea0bdddd518dce8bb31b9e2eea3c0f5b8a539ef774fcdedce18ce', '762f8f69f88f35496e1d000af2df66661aa705ae36fbcb3fd8926414a8674aea', 'evidence', 'reported_unverified', '2026-07-30T21:34:18Z', array['personnel_credentials_vault']),
    ('117d842ff30be14187ce0c642ecd6dfb15faa3a19e76a0d09522e836a633d23b', '13d00fbe8489843ad4f70f9ad5f6d733ae233878180233aefec75c1b3bc9f62a', 'evidence', 'reported_unverified', '2026-07-30T21:33:34Z', array['personnel_credentials_vault']),
    ('8f661693781067a78045f438391aeafe4053cc010fdbecdd0331050dac263e43', 'efc649e9c0649e1a53fbccebcb8fc696135de11dbdb0f5165a2021f997af6262', 'evidence', 'historical_update_required', '2026-07-30T21:33:08Z', array['supervigilancia_operating_license']),
    ('0c5493bc33ef12ca228dca3261e3b6ff245cfebbd2abad86e6332e7f1e8e4da2', 'd2cf15ab69ea36da3767dda8ce17acbb8107ec073de53a458c44e0acc869b560', 'evidence', 'reported_unverified', '2026-07-30T21:33:18Z', array['personnel_credentials_vault']),
    ('15779485f25caedb226c5993cb413a370c315d4e1c7951cbe6c6ff3eae425f82', 'feffbfa8594280ab539650474df0f4971b6b61926d3663d16123ca211b517bca', 'evidence', 'process_specific_template', '2026-07-30T21:32:46Z', array['differential_scoring_support']),
    ('a4f10f39fa149a07f1f9ff58936ba137a76c8d6660e27617c89369a5a920416d', '13bf06e5b4d25567e9a168875f189a44a311d672228b12e76264a40d49f02107', 'evidence', 'reported_unverified', '2026-07-30T21:33:48Z', array['personnel_credentials_vault']),
    ('e92faf896d8149b0ad1c65579f0e549cf35ce121472c75b966fe1e3dcfdecd28', '29435525672bc59568071e93e223b9e963edb8f70b976ddd8973a6bb285d6430', 'evidence', 'process_specific_template', '2026-07-30T21:33:20Z', array['differential_scoring_support']),
    ('09bc0234f7c2c17742ad49ad5a6dd3b2a50577665ad22f66154ac0cc64e67eb3', '9579840a324e1ea222dd4dde827c40028b2676ddd5a9d15d1596fda1fac5aab2', 'evidence', 'historical_update_required', '2026-07-30T21:34:37Z', array['no_fines_sanctions_certificate']),
    -- The one source row curated onto two classes: an N:M link, never a duplicated row.
    ('cb0e193c47d3c90fd08050a7cf076489ee87595c068cf3718872a0055be0da26', '22890ce5c8c7f9c56f21f745ddb163c5e20d550d3e2ec4e6c072e544cf500b73', 'evidence', 'historical_update_required', '2026-07-30T21:32:37Z', array['bank_certificate', 'financial_and_tax_pack']),
    ('565841610467a8469d74d9012c59dddcfe59190266b67acb1ce28fa5043bc28b', 'edec2632eb540342b14745a2ce4f0e5b932e4bb3ff803f64c5f2cd2fae790afb', 'evidence', 'reported_unverified', '2026-07-30T21:32:09Z', array['personnel_credentials_vault'])
),
inserted_sources as (
  insert into public.psi_agt002_company_evidence_source_files (
    source_fingerprint, source_revision, disposition, governed_state, last_modified_at, observed_at
  )
  select
    s.source_fingerprint, s.source_revision, s.disposition, s.governed_state, s.last_modified_at,
    -- Single reconciliation timestamp for the whole reviewed sweep.
    '2026-09-02T00:00:00.000Z'::timestamptz
  from seed s
  on conflict (source_fingerprint) do nothing
  returning id, source_fingerprint
),
resolved_sources as (
  select i.id, i.source_fingerprint
  from inserted_sources i
  union all
  select f.id, f.source_fingerprint
  from public.psi_agt002_company_evidence_source_files f
  join seed s on s.source_fingerprint = f.source_fingerprint
  where not exists (
    select 1 from inserted_sources i where i.source_fingerprint = f.source_fingerprint
  )
)
insert into public.psi_agt002_company_evidence_source_file_links (source_file_id, entry_id, entry_version)
select r.id, reg.entry_id, reg.version
from seed s
join resolved_sources r on r.source_fingerprint = s.source_fingerprint
cross join lateral unnest(s.entry_ids) as curated(entry_id)
join public.psi_agt002_company_evidence_registry reg
  on reg.entry_id = curated.entry_id
  and reg.current
  and reg.source_manifest_version = 'v0.3.1-approved-20260829'
on conflict do nothing;

-- The single safe read path: aggregate counts and one deterministic fingerprint, never a row
-- identity, a locator or free text.
--
-- catalog_snapshot_hash is a real sha256 over the whole catalog: for every source row, ordered
-- by its own fingerprint, the unit-separated (chr(31)) tuple of fingerprint, revision,
-- disposition, governed state, both timestamps in canonical UTC and its ordered class links,
-- with rows record-separated (chr(30)). A re-uploaded file, a re-classified state or a changed
-- class link therefore all change the hash even when every count stays identical — which is
-- what stops a corrected file from silently reusing a previous run's conclusions.
create or replace function public.psi_get_agt002_company_evidence_inventory_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with source_links as (
    select
      l.source_file_id,
      jsonb_agg(
        jsonb_build_array(l.entry_id, l.entry_version)
        order by l.entry_id, l.entry_version
      ) as links
    from public.psi_agt002_company_evidence_source_file_links l
    group by l.source_file_id
  ),
  catalog_rows as (
    select
      f.source_fingerprint,
      concat_ws(
        chr(31),
        f.source_fingerprint,
        f.source_revision,
        f.disposition,
        coalesce(f.governed_state, ''),
        to_char(f.last_modified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        to_char(f.observed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        coalesce(sl.links, '[]'::jsonb)::text
      ) as row_text
    from public.psi_agt002_company_evidence_source_files f
    left join source_links sl on sl.source_file_id = f.id
  ),
  catalog_hash as (
    select encode(
      extensions.digest(
        convert_to(
          coalesce(string_agg(cr.row_text, chr(30) order by cr.source_fingerprint), ''),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ) as catalog_snapshot_hash
    from catalog_rows cr
  ),
  totals as (
    select
      count(*)::int as source_file_count,
      count(*) filter (where f.disposition = 'excluded_non_evidence')::int as excluded_non_evidence_count,
      count(*) filter (where f.disposition = 'evidence' and f.governed_state = 'current_valid')::int as current_valid,
      count(*) filter (where f.disposition = 'evidence' and f.governed_state = 'historical_update_required')::int as historical_update_required,
      count(*) filter (where f.disposition = 'evidence' and f.governed_state = 'reported_unverified')::int as reported_unverified,
      count(*) filter (where f.disposition = 'evidence' and f.governed_state = 'absent_unknown')::int as absent_unknown,
      count(*) filter (where f.disposition = 'evidence' and f.governed_state = 'process_specific_template')::int as process_specific_template
    from public.psi_agt002_company_evidence_source_files f
  ),
  -- Canonical closed catalog order — matches AGT002_COMPANY_EVIDENCE_CLASS_IDS in
  -- agt002-company-evidence-classes.js exactly, never alphabetical by entry_id, so classes are
  -- already canonical and validateAgt002CompanyEvidenceInventorySnapshot never needs to reorder
  -- what this RPC returns.
  class_order (entry_id, ordinal) as (
    values
      ('supervigilancia_operating_license', 1),
      ('rup', 2),
      ('rut', 3),
      ('communications_license', 4),
      ('uniforms_resolution', 5),
      ('no_fines_sanctions_certificate', 6),
      ('authorized_weapons_list', 7),
      ('rce_policy', 8),
      ('collective_life_policy', 9),
      ('accredited_experience', 10),
      ('financial_and_tax_pack', 11),
      ('bank_certificate', 12),
      ('overtime_authorization', 13),
      ('corporate_background_checks', 14),
      ('legal_representative_vault', 15),
      ('personnel_credentials_vault', 16),
      ('differential_scoring_support', 17)
  ),
  classes as (
    select
      r.entry_id,
      co.ordinal,
      count(f.id)::int as source_file_count,
      count(f.id) filter (where f.governed_state = 'current_valid')::int as current_valid,
      count(f.id) filter (where f.governed_state = 'historical_update_required')::int as historical_update_required,
      count(f.id) filter (where f.governed_state = 'reported_unverified')::int as reported_unverified,
      count(f.id) filter (where f.governed_state = 'absent_unknown')::int as absent_unknown,
      count(f.id) filter (where f.governed_state = 'process_specific_template')::int as process_specific_template,
      max(f.observed_at) as last_reconciled_at
    from public.psi_agt002_company_evidence_registry r
    join class_order co on co.entry_id = r.entry_id
    left join public.psi_agt002_company_evidence_source_file_links l
      on l.entry_id = r.entry_id and l.entry_version = r.version
    left join public.psi_agt002_company_evidence_source_files f
      on f.id = l.source_file_id and f.disposition = 'evidence'
    where r.current
      and r.source_manifest_version = 'v0.3.1-approved-20260829'
    group by r.entry_id, co.ordinal
  )
  select jsonb_build_object(
    'inventory_version', 'agt002-company-evidence-sharepoint-catalog-v1',
    'catalog_snapshot_hash', (select h.catalog_snapshot_hash from catalog_hash h),
    'source_file_count', t.source_file_count,
    'excluded_non_evidence_count', t.excluded_non_evidence_count,
    'state_counts', jsonb_build_object(
      'current_valid', t.current_valid,
      'historical_update_required', t.historical_update_required,
      'reported_unverified', t.reported_unverified,
      'absent_unknown', t.absent_unknown,
      'process_specific_template', t.process_specific_template
    ),
    'classes', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'entry_id', c.entry_id,
            'source_file_count', c.source_file_count,
            'state_counts', jsonb_build_object(
              'current_valid', c.current_valid,
              'historical_update_required', c.historical_update_required,
              'reported_unverified', c.reported_unverified,
              'absent_unknown', c.absent_unknown,
              'process_specific_template', c.process_specific_template
            ),
            -- Closed precedence: a class is only ever described by the strongest state one of
            -- its own linked files carries, and a class with no linked file is absent_unknown
            -- rather than silently reported as satisfied.
            'effective_state', case
              when c.source_file_count = 0 then 'absent_unknown'
              when c.current_valid > 0 then 'current_valid'
              when c.historical_update_required > 0 then 'historical_update_required'
              when c.reported_unverified > 0 then 'reported_unverified'
              when c.process_specific_template > 0 then 'process_specific_template'
              else 'absent_unknown'
            end,
            'last_reconciled_at', to_char(
              c.last_reconciled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            )
          )
          order by c.ordinal
        )
        from classes c
      ),
      '[]'::jsonb
    )
  )
  from totals t
$$;

revoke all on function public.psi_get_agt002_company_evidence_inventory_snapshot() from public;
revoke all on function public.psi_get_agt002_company_evidence_inventory_snapshot() from anon;
revoke all on function public.psi_get_agt002_company_evidence_inventory_snapshot() from authenticated;
revoke all on function public.psi_get_agt002_company_evidence_inventory_snapshot() from service_role;
grant execute on function public.psi_get_agt002_company_evidence_inventory_snapshot() to service_role;

commit;
