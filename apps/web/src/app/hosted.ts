/**
 * Set only by the production image build (VITE_HOSTED=1). Hides features that
 * need the user's own computer: local whisper.cpp transcription and the
 * bookmarklet, which posts to a local 127.0.0.1 app.
 */
export const HOSTED = import.meta.env.VITE_HOSTED === '1';
