import { expect, test, vi } from 'vitest';
import { render, screen } from './render';
import { ImportMethodCards } from '../src/features/inbox/ImportMethodCards';
import { TranscriptPanel } from '../src/features/interview-prep/Transcript';
import { useTranscript } from '../src/features/interview-prep/useTranscript';
import { Recorder } from '../src/features/interview-prep/InterviewPrep';
import { useRecorder } from '../src/features/interview-prep/useRecorder';

// The production image builds with VITE_HOSTED=1.
vi.mock('../src/app/hosted', () => ({ HOSTED: true }));

function Panel() {
  const transcript = useTranscript();
  return (
    <TranscriptPanel
      transcript={transcript}
      recording={new Blob(['synthetic'], { type: 'audio/webm' })}
      questionId="hr-intro-01"
      variant={0}
      renderFeedback={() => null}
    />
  );
}

test('hosted build hides local transcription but keeps typing the answer', () => {
  render(<Panel />);
  expect(
    screen.queryByRole('button', { name: /Transcribe locally/ }),
  ).toBeNull();
  expect(screen.queryByText(/Transcribe locally sends/)).toBeNull();
  expect(screen.getByRole('textbox')).toBeEnabled();
});

function SpeakingPractice() {
  return (
    <Recorder
      recorder={useRecorder()}
      title="Say it out loud"
      transcript={<Panel />}
    />
  );
}

test('hosted build shows no recording controls; the transcript can still be typed', () => {
  render(<SpeakingPractice />);
  expect(screen.queryByRole('button', { name: /Record/ })).toBeNull();
  expect(screen.getByRole('textbox')).toBeEnabled();
});

test('hosted build offers no bookmarklet import', () => {
  render(
    <ImportMethodCards
      value="url"
      onChange={() => {}}
      panelId="panel"
      disabled={false}
    />,
  );
  expect(screen.queryByText('Bookmarklet')).toBeNull();
  expect(screen.getByText('Paste content')).toBeVisible();
});
