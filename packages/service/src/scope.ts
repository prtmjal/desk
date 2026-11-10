import type { Alias, CatalogIndex, CatalogItem, ScoredItem } from "@desk/core";
import { PgCatalogIndex, withTenant, type Db, type Tx } from "@desk/db";

/** Runs a callback with a tenant-scoped transaction: either a fresh one per call, or an existing one. */
export type Run = <R>(fn: (tx: Tx) => Promise<R>) => Promise<R>;

export const scopeOf = (db: Db, tenantId: string): Run => (fn) => withTenant(db, tenantId, fn);
export const scopeIn = (tx: Tx): Run => (fn) => fn(tx);

/**
 * CatalogIndex whose every call opens its own short tenant transaction. The pipeline
 * holds no database transaction while it waits on the model (which can take a minute).
 */
export class ScopedCatalog implements CatalogIndex {
  constructor(
    private run: Run,
    private tenantId: string,
  ) {}
  private on<R>(fn: (c: PgCatalogIndex) => Promise<R>): Promise<R> {
    return this.run((tx) => fn(new PgCatalogIndex(tx, this.tenantId)));
  }
  getById(id: string): Promise<CatalogItem | undefined> {
    return this.on((c) => c.getById(id));
  }
  exact(partKey: string): Promise<CatalogItem[]> {
    return this.on((c) => c.exact(partKey));
  }
  alias(customerId: string, partKey: string): Promise<Alias | undefined> {
    return this.on((c) => c.alias(customerId, partKey));
  }
  aliasByDescription(customerId: string, descriptionKey: string): Promise<Alias | undefined> {
    return this.on((c) => c.aliasByDescription(customerId, descriptionKey));
  }
  trigram(query: string, k: number): Promise<ScoredItem[]> {
    return this.on((c) => c.trigram(query, k));
  }
  learnAlias(alias: Alias): Promise<void> {
    return this.on((c) => c.learnAlias(alias));
  }
}
