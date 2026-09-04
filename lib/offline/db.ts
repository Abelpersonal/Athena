import type { CourseDownloadBundle, DownloadedCourseSummary, OfflineLesson, OfflineMindMap, OfflineQuizQuestions } from "./types.js";
import type { OutboxItem } from "../../src/offline/outbox.js";

/**
 * Phase 10, Deliverable 3: the real IndexedDB wrapper — browser-only (never imported from `src/`,
 * which has no DOM lib in its own tsconfig; see README, "Where offline code lives and why"). Not
 * unit tested (needs a real browser's IndexedDB, unavailable in this environment) — the PURE logic
 * this glue calls into (`src/offline/outbox.ts`'s `resolvePendingItems`) IS unit tested; this file
 * is intentionally thin around it.
 */

const DB_NAME = "athena-offline";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("courses")) db.createObjectStore("courses", { keyPath: "id" });
      if (!db.objectStoreNames.contains("modules")) db.createObjectStore("modules", { keyPath: "id" });
      if (!db.objectStoreNames.contains("lessons")) db.createObjectStore("lessons", { keyPath: "id" });
      if (!db.objectStoreNames.contains("quizQuestions")) db.createObjectStore("quizQuestions", { keyPath: "lessonId" });
      if (!db.objectStoreNames.contains("mindMaps")) db.createObjectStore("mindMaps", { keyPath: "courseId" });
      if (!db.objectStoreNames.contains("audio")) db.createObjectStore("audio", { keyPath: "url" });
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "id" });
      if (!db.objectStoreNames.contains("downloads")) db.createObjectStore("downloads", { keyPath: "courseId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(db: IDBDatabase, storeNames: string[], mode: IDBTransactionMode, run: (t: IDBTransaction) => Promise<T> | T): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeNames, mode);
    let result: T;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error("IndexedDB transaction aborted."));
    Promise.resolve(run(t)).then((r) => {
      result = r;
    });
  });
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Writes a full download bundle: structured records into their respective stores, audio chunks
 * fetched as real Blobs and stored keyed by url, and a `downloads` summary row (courseId, real
 * total size, real lesson/module ids) the storage-management UI reads. `onProgress` reports each
 * audio chunk as it's fetched — downloads are explicit and can be slow on a real connection.
 */
export async function saveCourseBundle(bundle: CourseDownloadBundle, onProgress?: (message: string) => void): Promise<void> {
  const db = await openDb();

  await tx(db, ["courses", "modules", "lessons", "quizQuestions", "mindMaps"], "readwrite", async (t) => {
    t.objectStore("courses").put({ ...bundle.course, downloadedAt: new Date().toISOString() });
    for (const m of bundle.modules) t.objectStore("modules").put(m);
    for (const l of bundle.lessons) t.objectStore("lessons").put(l);
    for (const q of bundle.quizQuestions) t.objectStore("quizQuestions").put(q);
    if (bundle.mindMap) t.objectStore("mindMaps").put(bundle.mindMap);
  });

  let totalBytes = 0;
  for (const chunk of bundle.audioChunks) {
    try {
      onProgress?.(`Downloading audio: ${chunk.url}...`);
      const res = await fetch(chunk.url);
      if (!res.ok) continue;
      const blob = await res.blob();
      totalBytes += blob.size;
      const audioDb = await openDb();
      await tx(audioDb, ["audio"], "readwrite", (t) => {
        t.objectStore("audio").put({ url: chunk.url, blob, contentType: res.headers.get("content-type") ?? "audio/mpeg" });
      });
    } catch {
      // A single chunk failing to download doesn't abort the whole course download — the lesson
      // still works offline for text/quiz, just without that one audio chunk cached.
      onProgress?.(`  Skipped (failed to fetch): ${chunk.url}`);
    }
  }

  // Rough size accounting for the structured JSON too, not just audio — good enough for the
  // storage-management UI's "how much space will this free" display, not a byte-exact figure.
  totalBytes += new TextEncoder().encode(JSON.stringify(bundle)).length;

  const cachedUrls = [...bundle.pageUrls, ...bundle.audioChunks.map((c) => c.url)];
  await tx(db, ["downloads"], "readwrite", (t) => {
    t.objectStore("downloads").put({
      courseId: bundle.course.id,
      topic: bundle.course.topic,
      downloadedAt: new Date().toISOString(),
      sizeBytes: totalBytes,
      lessonIds: bundle.lessons.map((l) => l.id),
      cachedUrls,
    } satisfies DownloadedCourseSummary);
  });

  onProgress?.(`Done — ${bundle.lessons.length} lesson(s), ${bundle.audioChunks.length} audio chunk(s).`);
}

export async function listDownloadedCourses(): Promise<DownloadedCourseSummary[]> {
  const db = await openDb();
  return tx(db, ["downloads"], "readonly", async (t) => reqToPromise(t.objectStore("downloads").getAll()));
}

/** Removes every record belonging to one downloaded course, across every store — the real "free up space" action. */
export async function removeDownloadedCourse(courseId: string): Promise<void> {
  const db = await openDb();
  const summary = await tx(db, ["downloads"], "readonly", (t) => reqToPromise<DownloadedCourseSummary | undefined>(t.objectStore("downloads").get(courseId)));
  const lessonIds = summary?.lessonIds ?? [];

  await tx(db, ["courses", "modules", "lessons", "quizQuestions", "mindMaps", "downloads"], "readwrite", async (t) => {
    t.objectStore("courses").delete(courseId);
    t.objectStore("mindMaps").delete(courseId);
    t.objectStore("downloads").delete(courseId);
    const moduleRows = (await reqToPromise(t.objectStore("modules").getAll())) as { id: string; courseId: string }[];
    for (const m of moduleRows) {
      if (m.courseId === courseId) t.objectStore("modules").delete(m.id);
    }
    for (const lessonId of lessonIds) {
      t.objectStore("lessons").delete(lessonId);
      t.objectStore("quizQuestions").delete(lessonId);
    }
  });

  // Audio is keyed by url, not lessonId directly — sweep for any url containing a downloaded lessonId.
  const audioDb = await openDb();
  await tx(audioDb, ["audio"], "readwrite", async (t) => {
    const allAudio = (await reqToPromise(t.objectStore("audio").getAll())) as { url: string }[];
    for (const row of allAudio) {
      if (lessonIds.some((id) => row.url.includes(id))) t.objectStore("audio").delete(row.url);
    }
  });

  // Also clear the service worker's Cache API entries (pages + audio) this course populated —
  // without this, "remove" only frees IndexedDB's share of the space, not the (often larger)
  // cached-page/audio share, which would fail a real before/after storage check.
  if ("serviceWorker" in navigator && summary?.cachedUrls) {
    const reg = await navigator.serviceWorker.ready;
    reg.active?.postMessage({ type: "CLEAR_URLS", urls: summary.cachedUrls });
  }
}

export async function getOfflineLesson(lessonId: string): Promise<OfflineLesson | undefined> {
  const db = await openDb();
  return tx(db, ["lessons"], "readonly", (t) => reqToPromise(t.objectStore("lessons").get(lessonId)));
}

export async function getOfflineQuizQuestions(lessonId: string): Promise<OfflineQuizQuestions | undefined> {
  const db = await openDb();
  return tx(db, ["quizQuestions"], "readonly", (t) => reqToPromise(t.objectStore("quizQuestions").get(lessonId)));
}

export async function getOfflineMindMap(courseId: string): Promise<OfflineMindMap | undefined> {
  const db = await openDb();
  return tx(db, ["mindMaps"], "readonly", (t) => reqToPromise(t.objectStore("mindMaps").get(courseId)));
}

export async function getOfflineAudioObjectUrl(url: string): Promise<string | undefined> {
  const db = await openDb();
  const row = await tx(db, ["audio"], "readonly", (t) => reqToPromise<{ url: string; blob: Blob } | undefined>(t.objectStore("audio").get(url)));
  return row ? URL.createObjectURL(row.blob) : undefined;
}

// ---------------------------------------------------------------------------
// Outbox (Deliverable 4) — the real IndexedDB glue around src/offline/outbox.ts's pure core.
// ---------------------------------------------------------------------------

export async function enqueueOutboxItem(item: OutboxItem): Promise<void> {
  const db = await openDb();
  await tx(db, ["outbox"], "readwrite", (t) => {
    t.objectStore("outbox").put(item);
  });
}

export async function listOutboxItems(): Promise<OutboxItem[]> {
  const db = await openDb();
  return tx(db, ["outbox"], "readonly", (t) => reqToPromise(t.objectStore("outbox").getAll()));
}

export async function removeOutboxItems(ids: string[]): Promise<void> {
  const db = await openDb();
  await tx(db, ["outbox"], "readwrite", (t) => {
    for (const id of ids) t.objectStore("outbox").delete(id);
  });
}
