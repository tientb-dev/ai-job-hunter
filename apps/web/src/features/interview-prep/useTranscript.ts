import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MAX_ANSWER_CHARS,
  PracticeError,
  requestFeedback,
  transcribe,
  type PracticeFeedback,
} from './interview-prep-api';
import { WavError, toWav, type WavErrorCode } from './wav';

const WAV_MESSAGES: Record<WavErrorCode, string> = {
  UNSUPPORTED:
    "This browser can't prepare audio for transcription. You can type your answer instead.",
  DECODE:
    "This browser couldn't read the recording. Record again, or type your answer.",
  EMPTY: 'The recording is too short. Record at least half a second.',
  TOO_LONG:
    'This recording is longer than 3 minutes. Record a shorter answer, or type it.',
};

type Status =
  | { kind: 'idle'; done?: boolean }
  | { kind: 'converting' | 'transcribing' }
  | { kind: 'error'; message: string };
export type TranscriptFeedback =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  /** `answer`: the exact text sent, to detect later edits. */
  | { kind: 'done'; feedback: PracticeFeedback; answer: string };

/**
 * Editable transcript for one question. Never saved. Only the latest request
 * may write, and never over text the user typed while it was running.
 */
export function useTranscript() {
  const [text, setText] = useState('');
  // 'edited': typed by the user (or changed after transcription).
  const [source, setSource] = useState<'empty' | 'stt' | 'edited'>('empty');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [confirming, setConfirming] = useState(false);
  const request = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const [feedback, setFeedback] = useState<TranscriptFeedback>({
    kind: 'idle',
  });
  const feedbackRequest = useRef<AbortController | null>(null);
  const feedbackSequence = useRef(0);
  const busy = status.kind === 'converting' || status.kind === 'transcribing';

  const abandon = useCallback(() => {
    sequence.current++;
    request.current?.abort();
    request.current = null;
  }, []);
  const abandonFeedback = useCallback(() => {
    feedbackSequence.current++;
    feedbackRequest.current?.abort();
    feedbackRequest.current = null;
  }, []);
  useEffect(
    () => () => {
      abandon();
      abandonFeedback();
    },
    [abandon, abandonFeedback],
  );
  /** New take or stop: drop any in-flight request, keep the text. */
  const cancel = useCallback(() => {
    abandon();
    setConfirming(false);
    setStatus((s) =>
      s.kind === 'converting' || s.kind === 'transcribing'
        ? { kind: 'idle' }
        : s,
    );
  }, [abandon]);

  const start = async (recording: Blob, questionId: string) => {
    abandon();
    const ticket = sequence.current;
    const controller = new AbortController();
    request.current = controller;
    setConfirming(false);
    setStatus({ kind: 'converting' });
    try {
      const wav = await toWav(recording);
      if (ticket !== sequence.current) return;
      setStatus({ kind: 'transcribing' });
      const result = await transcribe(wav, questionId, controller.signal);
      if (ticket !== sequence.current) return;
      if (!result.transcript) {
        setStatus({
          kind: 'error',
          message: 'No speech was detected. Record again, or type your answer.',
        });
        return;
      }
      setText(result.transcript);
      setSource('stt');
      setStatus({ kind: 'idle', done: true });
    } catch (error) {
      if (ticket !== sequence.current) return;
      setStatus({
        kind: 'error',
        message:
          error instanceof WavError
            ? WAV_MESSAGES[error.code]
            : error instanceof PracticeError
              ? error.message
              : 'Transcription failed. Try again, or type your answer.',
      });
    } finally {
      if (request.current === controller) request.current = null;
    }
  };
  /** Existing feedback endpoint and safeguards; the reviewed text is the answer. */
  const askFeedback = async (questionId: string, variant: number) => {
    const answer = text.trim();
    if (!answer || text.length > MAX_ANSWER_CHARS || busy) return;
    abandonFeedback();
    const ticket = feedbackSequence.current;
    const controller = new AbortController();
    feedbackRequest.current = controller;
    setFeedback({ kind: 'loading' });
    try {
      const result = await requestFeedback(
        // Spoken English: review it rather than rewrite Vietnamese notes.
        { questionId, mode: 'review', answer, variant },
        controller.signal,
      );
      if (ticket !== feedbackSequence.current) return;
      setFeedback({ kind: 'done', feedback: result, answer });
    } catch (error) {
      if (ticket !== feedbackSequence.current || controller.signal.aborted)
        return;
      setFeedback({
        kind: 'error',
        message:
          error instanceof PracticeError
            ? error.message
            : 'Feedback is unavailable right now. Your text is kept — try again.',
      });
    } finally {
      if (feedbackRequest.current === controller)
        feedbackRequest.current = null;
    }
  };
  return {
    text,
    feedback,
    askFeedback,
    /** Feedback for text that has since changed. */
    outdated: feedback.kind === 'done' && feedback.answer !== text.trim(),
    status,
    busy,
    confirming,
    /** Re-transcribing over typed text needs an explicit Replace. */
    run: (recording: Blob, questionId: string) =>
      source === 'edited' && text.trim()
        ? setConfirming(true)
        : void start(recording, questionId),
    replace: (recording: Blob, questionId: string) =>
      void start(recording, questionId),
    keep: () => setConfirming(false),
    edit: (value: string) => {
      setText(value);
      setSource(value ? 'edited' : 'empty');
      if (busy) {
        abandon();
        setStatus({
          kind: 'error',
          message: 'Transcription stopped because you edited the text.',
        });
      }
      // A result for the previous text must not land under the new one.
      if (feedback.kind === 'loading') {
        abandonFeedback();
        setFeedback({ kind: 'idle' });
      }
    },
    cancel,
    /** Question change: everything goes. */
    reset: () => {
      abandon();
      abandonFeedback();
      setFeedback({ kind: 'idle' });
      setText('');
      setSource('empty');
      setConfirming(false);
      setStatus({ kind: 'idle' });
    },
  };
}
