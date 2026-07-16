export type AccessAssignment = {
  area_code: string;
  subarea_code: string | null;
};

export function setAreaScopeSelection(
  current: AccessAssignment[],
  areaCode: string,
  subareaCode: string | null,
  checked: boolean,
): AccessAssignment[] {
  if (!checked) {
    return current.filter(scope => !(scope.area_code === areaCode && scope.subarea_code === subareaCode));
  }

  const otherAreas = current.filter(scope => scope.area_code !== areaCode);
  if (subareaCode === null) {
    return [...otherAreas, { area_code: areaCode, subarea_code: null }];
  }

  const sameAreaSubareas = current.filter(scope => scope.area_code === areaCode && scope.subarea_code !== null);
  const next = [...otherAreas, ...sameAreaSubareas, { area_code: areaCode, subarea_code: subareaCode }];
  return next.filter((scope, index, all) =>
    all.findIndex(other => other.area_code === scope.area_code && other.subarea_code === scope.subarea_code) === index
  );
}
