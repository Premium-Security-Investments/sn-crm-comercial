const CLAIM_KEYS = Object.freeze([
  'iss', 'sub', 'aud', 'azp', 'iat', 'exp', 'jti', 'act',
  'agent_id', 'capability', 'channel', 'correlation_id', 'environment',
]);
const ACTOR_KEYS = Object.freeze(['sub']);

function denied() {
  throw new Error('delegation denied');
}

function hasExactDataShape(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) return false;
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && descriptor.enumerable && Object.hasOwn(descriptor, 'value');
  });
}

function isIdentifier(value) {
  return typeof value === 'string' && /^syn-[a-z0-9-]{3,120}$/.test(value);
}

function isLabel(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._:-]{2,120}$/.test(value);
}

function snapshotClaims(input) {
  if (!hasExactDataShape(input, CLAIM_KEYS) || !hasExactDataShape(input.act, ACTOR_KEYS)) denied();
  let cloned;
  try {
    cloned = structuredClone(input);
  } catch {
    denied();
  }
  if (!hasExactDataShape(cloned, CLAIM_KEYS) || !hasExactDataShape(cloned.act, ACTOR_KEYS)) denied();
  const snapshot = {
    iss: cloned.iss,
    sub: cloned.sub,
    aud: cloned.aud,
    azp: cloned.azp,
    iat: cloned.iat,
    exp: cloned.exp,
    jti: cloned.jti,
    actSub: cloned.act.sub,
    agentId: cloned.agent_id,
    capability: cloned.capability,
    channel: cloned.channel,
    correlationId: cloned.correlation_id,
    environment: cloned.environment,
  };
  if (
    !isLabel(snapshot.iss)
    || !isIdentifier(snapshot.sub)
    || snapshot.aud !== 'siio'
    || !isLabel(snapshot.azp)
    || !Number.isSafeInteger(snapshot.iat)
    || !Number.isSafeInteger(snapshot.exp)
    || !isIdentifier(snapshot.jti)
    || !isIdentifier(snapshot.actSub)
    || !/^AGT-\d{3}$/.test(snapshot.agentId)
    || !/^agt\d{3}\.[a-z0-9._-]{3,120}$/.test(snapshot.capability)
    || !isLabel(snapshot.channel)
    || !isIdentifier(snapshot.correlationId)
    || !isLabel(snapshot.environment)
  ) denied();
  return Object.freeze(snapshot);
}

function currentTime(clock) {
  const now = clock();
  if (!Number.isSafeInteger(now)) denied();
  return now;
}

function hasDenseStringArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1 || ownKeys.at(-1) !== 'length') return false;
  for (let index = 0; index < value.length; index += 1) {
    if (ownKeys[index] !== String(index)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string') return false;
  }
  return true;
}

function snapshotTrustPolicy(policy) {
  const keys = ['issuers', 'authorizedParties', 'channels', 'environments'];
  if (!hasExactDataShape(policy, keys)) denied();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(policy, key);
    if (!descriptor || !hasDenseStringArray(descriptor.value)) denied();
  }
  let cloned;
  try {
    cloned = structuredClone(policy);
  } catch {
    denied();
  }
  if (!hasExactDataShape(cloned, keys) || keys.some((key) => !hasDenseStringArray(cloned[key]))) denied();
  for (const key of keys) Object.freeze(cloned[key]);
  return Object.freeze(cloned);
}

function validTimeWindow(snapshot, now) {
  return snapshot.exp > snapshot.iat
    && snapshot.exp - snapshot.iat <= 300
    && snapshot.iat <= now
    && now < snapshot.exp;
}

function containsOwnValue(list, expected) {
  for (let index = 0; index < list.length; index += 1) {
    if (list[index] === expected) return true;
  }
  return false;
}

function trusted(snapshot, trustPolicy) {
  return containsOwnValue(trustPolicy.issuers, snapshot.iss)
    && containsOwnValue(trustPolicy.authorizedParties, snapshot.azp)
    && containsOwnValue(trustPolicy.channels, snapshot.channel)
    && containsOwnValue(trustPolicy.environments, snapshot.environment);
}

export async function verifySyntheticAgentDelegation(input, dependencies) {
  try {
    if (!hasExactDataShape(dependencies, ['clock', 'replayStore', 'trustPolicy'])) denied();
    if (typeof dependencies.clock !== 'function' || !dependencies.replayStore || typeof dependencies.replayStore.consume !== 'function') denied();
    const snapshot = snapshotClaims(input);
    const trustPolicy = snapshotTrustPolicy(dependencies.trustPolicy);
    if (!trusted(snapshot, trustPolicy)) denied();
    if (!validTimeWindow(snapshot, currentTime(dependencies.clock))) denied();
    if (await dependencies.replayStore.consume(snapshot.jti) !== true) denied();
    if (!validTimeWindow(snapshot, currentTime(dependencies.clock))) denied();
    return Object.freeze({
      issuer: snapshot.iss,
      subject: snapshot.sub,
      audience: snapshot.aud,
      authorized_party: snapshot.azp,
      actor_subject: snapshot.actSub,
      agent_id: snapshot.agentId,
      capability: snapshot.capability,
      channel: snapshot.channel,
      correlation_id: snapshot.correlationId,
      environment: snapshot.environment,
      issued_at: snapshot.iat,
      expires_at: snapshot.exp,
      jti: snapshot.jti,
    });
  } catch {
    denied();
  }
}
