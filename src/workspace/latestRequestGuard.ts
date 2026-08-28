export type RequestToken<Key> = Readonly<{
  key: Key;
  generation: number;
}>;

/** Grants commit ownership only to the latest asynchronous request for a key. */
export class LatestRequestGuard<Key> {
  private readonly generations = new Map<Key, number>();

  begin(key: Key): RequestToken<Key> {
    const generation = (this.generations.get(key) ?? 0) + 1;
    this.generations.set(key, generation);
    return { key, generation };
  }

  isCurrent(token: RequestToken<Key>): boolean {
    return this.generations.get(token.key) === token.generation;
  }

  invalidate(key: Key): void {
    this.begin(key);
  }
}
