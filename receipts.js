/**
 * Receipt blobs in IndexedDB (never localStorage).
 * Extension point: OCR can read blobs by receiptId later.
 */
(function (global) {
  "use strict";

  const DB_NAME = "calmplan-receipts";
  const DB_VERSION = 1;
  const STORE = "receipts";

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
    });
  }

  async function putReceipt(id, blob, meta) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({
        id,
        blob,
        mime: (blob && blob.type) || (meta && meta.mime) || "application/octet-stream",
        name: (meta && meta.name) || "",
        createdAt: new Date().toISOString(),
      });
      tx.oncomplete = () => resolve(id);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getReceipt(id) {
    if (!id) return null;
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteReceipt(id) {
    if (!id) return;
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  global.CalmPlanReceipts = { putReceipt, getReceipt, deleteReceipt };
})(typeof window !== "undefined" ? window : globalThis);
