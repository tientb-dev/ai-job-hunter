import { act, fireEvent, render, screen } from './render';
import { expect, test, vi } from 'vitest';
import { useNotify } from '../src/components/useNotify';

function Controls() {
  const notify = useNotify();
  return (
    <main>
      <button
        onClick={() =>
          notify({ severity: 'error', text: 'Save failed. Retry.' })
        }
      >
        Error
      </button>
      <button
        onClick={() =>
          notify({ severity: 'success', text: 'Saved successfully' })
        }
      >
        Success
      </button>
      <button onClick={() => notify({ severity: 'info', text: 'Information' })}>
        Info
      </button>
      <button
        onClick={() =>
          notify({ severity: 'warning', text: 'Review source errors' })
        }
      >
        Warning
      </button>
    </main>
  );
}

test('one portal host queues notifications without replacing persistent errors', async () => {
  vi.useFakeTimers();
  const { container } = render(<Controls />);
  fireEvent.click(screen.getByText('Error'));
  fireEvent.click(screen.getByText('Success'));
  fireEvent.click(screen.getByText('Info'));
  const error = screen.getByRole('alert');
  expect(error).toHaveAttribute('aria-live', 'assertive');
  expect(error.closest('.MuiSnackbar-root')).toHaveStyle({ position: 'fixed' });
  expect(container.contains(error)).toBe(false);
  expect(document.querySelectorAll('.MuiSnackbar-root')).toHaveLength(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(error).toHaveTextContent('Save failed. Retry.');
  expect(screen.queryByText('Saved successfully')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  // The newer info toast superseded the queued success; the error stayed.
  expect(screen.getByRole('status')).toHaveTextContent('Information');
  expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  expect(screen.queryByText('Saved successfully')).not.toBeInTheDocument();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6500);
  });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Warning'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(screen.getByRole('alert')).toHaveTextContent('Review source errors');
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
