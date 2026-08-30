export type CanonicalJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue | undefined };

function normalize(value: CanonicalJsonValue): CanonicalJsonValue {
  if (Array.isArray(value)) return value.map(normalize);
  if (value instanceof Object) {
    const result: { [key: string]: CanonicalJsonValue | undefined } = {};
    for (const [key, entry] of Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) {
      if (entry !== undefined) result[key] = normalize(entry);
    }
    return result;
  }
  return value;
}

export function canonicalJson<T>(value: T): string {
  // SAFETY: Callers provide JSON-compatible request and response domain objects; normalization only traverses those values.
  const domainValue = value as CanonicalJsonValue;
  return JSON.stringify(normalize(domainValue));
}
