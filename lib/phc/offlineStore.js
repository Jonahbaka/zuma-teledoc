const DATABASE_NAME = 'doctarx-phc-protected-store';
const DATABASE_VERSION = 1;
const KEY_ALGORITHM = { name: 'AES-GCM', length: 256 };

function requireBrowserStorage() {
  if (typeof window === 'undefined' || !window.indexedDB || !window.crypto?.subtle) {
    throw new Error('Protected offline storage is unavailable in this browser.');
  }
}

function openDatabase() {
  requireBrowserStorage();
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('keys')) database.createObjectStore('keys', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('metadata')) database.createObjectStore('metadata', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('operations')) {
        const operations = database.createObjectStore('operations', { keyPath: 'operationId' });
        operations.createIndex('ownerContext', ['ownerUserId', 'contextKey'], { unique: false });
        operations.createIndex('owner', 'ownerUserId', { unique: false });
      }
    };
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function inStore(storeName, mode, callback) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const result = await callback(store);
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Offline storage transaction aborted.'));
    });
    return result;
  } finally {
    database.close();
  }
}

function bytesToBase64(bytes) {
  let value = '';
  bytes.forEach((byte) => { value += String.fromCharCode(byte); });
  return window.btoa(value);
}

function base64ToBytes(value) {
  return Uint8Array.from(window.atob(value), (character) => character.charCodeAt(0));
}

function contextKey(context) {
  const programmeId = context?.programmeId || context?.programme_id;
  const facilityId = context?.facilityId || context?.facility_id;
  if (!programmeId || !facilityId) throw new Error('Programme and facility context are required.');
  return `${programmeId}:${facilityId}`;
}

function randomUuid() {
  return window.crypto.randomUUID();
}

async function getOrCreateEncryptionKey(ownerUserId) {
  const id = `clinical-aes-v1:${ownerUserId}`;
  const existing = await inStore('keys', 'readonly', (store) => requestResult(store.get(id)));
  if (existing?.key) return existing.key;
  const key = await window.crypto.subtle.generateKey(KEY_ALGORITHM, false, ['encrypt', 'decrypt']);
  await inStore('keys', 'readwrite', (store) => requestResult(store.put({ id, key, createdAt: new Date().toISOString() })));
  return key;
}

async function encryptOperation(ownerUserId, operation) {
  const key = await getOrCreateEncryptionKey(ownerUserId);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const additionalData = new TextEncoder().encode(
    `${ownerUserId}|${operation.contextKey}|${operation.operationId}|${operation.entityType}`
  );
  const plaintext = new TextEncoder().encode(JSON.stringify(operation.payload));
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData, tagLength: 128 },
    key,
    plaintext
  );
  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
}

async function decryptOperation(ownerUserId, operation) {
  if (operation.ownerUserId !== ownerUserId) throw new Error('Offline operation owner mismatch.');
  const key = await getOrCreateEncryptionKey(ownerUserId);
  const additionalData = new TextEncoder().encode(
    `${ownerUserId}|${operation.contextKey}|${operation.operationId}|${operation.entityType}`
  );
  const plaintext = await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64ToBytes(operation.iv),
      additionalData,
      tagLength: 128,
    },
    key,
    base64ToBytes(operation.ciphertext)
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

export async function getOrCreateDevicePublicId(ownerUserId) {
  const id = `device-public-id:${ownerUserId}`;
  const existing = await inStore('metadata', 'readonly', (store) => requestResult(store.get(id)));
  if (existing?.value) return existing.value;
  const value = randomUuid();
  await inStore('metadata', 'readwrite', (store) => requestResult(store.put({ id, value })));
  return value;
}

export async function queueOfflineOperation({
  ownerUserId,
  context,
  entityType,
  entityId = null,
  payload,
  operationId = randomUuid(),
}) {
  if (!ownerUserId) throw new Error('Authenticated user is required for protected offline storage.');
  const operation = {
    operationId,
    ownerUserId,
    contextKey: contextKey(context),
    entityType,
    entityId,
    operationType: 'create',
    clientRecordVersion: 1,
    payload,
    createdAt: new Date().toISOString(),
  };
  const encrypted = await encryptOperation(ownerUserId, operation);
  const stored = {
    operationId,
    ownerUserId,
    contextKey: operation.contextKey,
    entityType,
    entityId,
    operationType: 'create',
    clientRecordVersion: 1,
    createdAt: operation.createdAt,
    status: 'pending',
    ...encrypted,
  };
  await inStore('operations', 'readwrite', (store) => requestResult(store.put(stored)));
  return stored;
}

export async function listOfflineOperations(ownerUserId, context) {
  const key = contextKey(context);
  const records = await inStore('operations', 'readonly', (store) => requestResult(
    store.index('ownerContext').getAll([ownerUserId, key])
  ));
  const retryable = records
    .filter((record) => ['pending', 'failed'].includes(record.status))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  return Promise.all(retryable.map(async (record) => ({
    operationId: record.operationId,
    entityType: record.entityType,
    entityId: record.entityId,
    operationType: record.operationType,
    clientRecordVersion: record.clientRecordVersion,
    payload: await decryptOperation(ownerUserId, record),
  })));
}

export async function applyOfflineSyncResults(ownerUserId, results) {
  const records = await inStore('operations', 'readonly', (store) => requestResult(
    store.index('owner').getAll(ownerUserId)
  ));
  const ownedById = new Map(records.map((record) => [record.operationId, record]));
  await inStore('operations', 'readwrite', (store) => {
    for (const result of results) {
      const record = ownedById.get(result.operationId);
      if (!record) continue;
      if (result.status === 'applied') {
        store.delete(result.operationId);
      } else {
        store.put({
          ...record,
          status: result.status,
          errorCode: result.code || null,
          lastAttemptAt: new Date().toISOString(),
        });
      }
    }
  });
}

export async function countOfflineOperations(ownerUserId, context) {
  const key = contextKey(context);
  const records = await inStore('operations', 'readonly', (store) => requestResult(
    store.index('ownerContext').getAll([ownerUserId, key])
  ));
  return records.reduce((counts, record) => {
    counts[record.status] = (counts[record.status] || 0) + 1;
    return counts;
  }, { pending: 0, failed: 0, conflict: 0, rejected: 0 });
}

export async function clearOfflineClinicalData(ownerUserId) {
  if (!ownerUserId) return;
  const owned = await inStore('operations', 'readonly', (store) => requestResult(
    store.index('owner').getAllKeys(ownerUserId)
  ));
  const database = await openDatabase();
  try {
    const transaction = database.transaction(['operations', 'keys', 'metadata'], 'readwrite');
    const operations = transaction.objectStore('operations');
    owned.forEach((key) => operations.delete(key));
    transaction.objectStore('keys').delete(`clinical-aes-v1:${ownerUserId}`);
    transaction.objectStore('metadata').delete(`device-public-id:${ownerUserId}`);
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Offline wipe aborted.'));
    });
  } finally {
    database.close();
  }
}
