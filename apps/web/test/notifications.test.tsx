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

test('errors open one centred dialog until acknowledged; success/info is a small top popup', async () => {
  vi.useFakeTimers();
  try {
    render(<Controls />);
    fireEvent.click(screen.getByText('Error'));
    fireEvent.click(screen.getByText('Success'));
    fireEvent.click(screen.getByText('Info'));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Action failed');
    expect(dialog).toHaveTextContent('Save failed. Retry.');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(10000));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    // The newer info popup superseded the queued success; the error stayed.
    const popup = screen.getByRole('status');
    expect(popup).toHaveTextContent('Information');
    expect(popup.closest('.MuiDialog-root')).not.toBeNull();
    expect(screen.queryByText('Saved successfully')).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(6000));
    // React renders the close after this tick; then the fade-out runs.
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Warning'));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Review source errors',
    );
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test('Retry is offered only when the caller passes a safe retry action', async () => {
  const retry = vi.fn();
  function WithRetry() {
    const notify = useNotify();
    return (
      <button
        onClick={() =>
          notify({ severity: 'error', text: 'Load failed', onRetry: retry })
        }
      >
        Fail
      </button>
    );
  }
  render(<WithRetry />);
  fireEvent.click(screen.getByText('Fail'));
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(retry).toHaveBeenCalledTimes(1);
});

test('success closes after about 3.5s; an error with a title stays until dismissed', async () => {
  vi.useFakeTimers();
  try {
    function Titled() {
      const notify = useNotify();
      return (
        <button
          onClick={() =>
            notify({
              severity: 'error',
              title: 'Review action failed',
              text: 'Check the local API and retry.',
            })
          }
        >
          Titled error
        </button>
      );
    }
    render(
      <>
        <Controls />
        <Titled />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Success' }));
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(screen.getByText('Saved successfully')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(500));
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(screen.queryByText('Saved successfully')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Titled error' }));
    await act(() => vi.advanceTimersByTimeAsync(30000));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Review action failed');
    expect(dialog).toHaveTextContent('Check the local API and retry.');
  } finally {
    vi.useRealTimers();
  }
});
