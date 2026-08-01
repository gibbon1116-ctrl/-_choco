export async function getStorageStatus(storage = globalThis.navigator?.storage) {
  if (!storage) {
    return { supported: false, persisted: false, usage: null, quota: null };
  }
  const [persisted, estimate] = await Promise.all([
    storage.persisted?.() ?? false,
    storage.estimate?.() ?? {},
  ]);
  return {
    supported: true,
    persisted: Boolean(persisted),
    usage: Number.isFinite(estimate.usage) ? Number(estimate.usage) : null,
    quota: Number.isFinite(estimate.quota) ? Number(estimate.quota) : null,
  };
}

export async function requestStoragePersistence(storage = globalThis.navigator?.storage) {
  if (!storage?.persist) return false;
  return Boolean(await storage.persist());
}
