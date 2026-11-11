import { useCallback, useEffect, useRef, useState } from 'react';

export type RecorderState =
  'idle' | 'requesting' | 'recording' | 'ready' | 'unavailable';
const MAX_RECORDING_MS = 3 * 60 * 1000;

export const recordingSupported = () =>
  typeof navigator !== 'undefined' &&
  typeof navigator.mediaDevices?.getUserMedia === 'function' &&
  typeof MediaRecorder !== 'undefined';

/**
 * Browser self-review recording. Audio stays in memory as one object URL and
 * is uploaded only when the user chooses local transcription; never stored. Any failure (permission, no device, unsupported,
 * recorder error) becomes "unavailable" — browsers disagree on error names.
 */
export function useRecorder() {
  const [state, setState] = useState<RecorderState>(
    recordingSupported() ? 'idle' : 'unavailable',
  );
  const [url, setUrl] = useState<string | null>(null);
  // The take itself, for optional local transcription (PR16).
  const [blob, setBlob] = useState<Blob | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const urlRef = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Bumped by reset(): a permission prompt that resolves late must not start recording.
  const generation = useRef(0);

  const release = useCallback(() => {
    clearTimeout(timer.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }, []);
  const dropAudio = useCallback(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setUrl(null);
    setBlob(null);
  }, []);

  const stop = useCallback(() => {
    const active = recorder.current;
    if (active && active.state !== 'inactive')
      active.stop(); // onstop releases the microphone
    else release();
  }, [release]);

  const start = useCallback(async () => {
    if (!recordingSupported()) return setState('unavailable');
    const ticket = ++generation.current;
    dropAudio(); // recording again replaces the previous take
    setState('requesting');
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      if (ticket === generation.current) setState('unavailable');
      return;
    }
    if (ticket !== generation.current) {
      media.getTracks().forEach((track) => track.stop());
      return;
    }
    stream.current = media;
    try {
      const next = new MediaRecorder(media);
      const chunks: Blob[] = [];
      next.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      next.onstop = () => {
        release();
        recorder.current = null;
        if (ticket !== generation.current) return;
        const blob = new Blob(chunks, { type: next.mimeType || 'audio/webm' });
        if (!blob.size) return setState('idle');
        urlRef.current = URL.createObjectURL(blob);
        setUrl(urlRef.current);
        setBlob(blob);
        setState('ready');
      };
      next.onerror = () => {
        release();
        recorder.current = null;
        if (ticket === generation.current) setState('unavailable');
      };
      recorder.current = next;
      next.start();
      setState('recording');
      timer.current = setTimeout(() => {
        if (next.state !== 'inactive') next.stop();
      }, MAX_RECORDING_MS);
    } catch {
      release();
      recorder.current = null;
      setState('unavailable');
    }
  }, [dropAudio, release]);

  /** Discard the take and release the microphone (question/topic change, Try again, unmount). */
  const reset = useCallback(() => {
    generation.current++;
    const active = recorder.current;
    recorder.current = null;
    if (active && active.state !== 'inactive') active.stop();
    release();
    dropAudio();
    setState(recordingSupported() ? 'idle' : 'unavailable');
  }, [dropAudio, release]);

  // Unmount: release the microphone and free the audio (no state updates needed).
  useEffect(
    () => () => {
      generation.current++;
      const active = recorder.current;
      recorder.current = null;
      if (active && active.state !== 'inactive') active.stop();
      release();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [release],
  );

  return { state, url, blob, start, stop, reset };
}
