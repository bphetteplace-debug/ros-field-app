// Vitest setup. Runs before every test file.

// fake-indexeddb polyfills the IndexedDB API so offline-queue tests can
// exercise queueOfflineSubmission / getOfflineQueue / removeFromOfflineQueue
// against a real (in-memory) implementation. jsdom does NOT ship IDB.
import 'fake-indexeddb/auto';

// jest-dom matchers (toBeInTheDocument, etc). We don't have UI tests yet
// but the helpers are cheap to load and ready when we add them.
import '@testing-library/jest-dom/vitest';
