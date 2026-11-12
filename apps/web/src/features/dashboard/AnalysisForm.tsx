import { AutoAwesomeIcon } from '../../components/icons';
import { useId, useRef, useState } from 'react';
import { Button, Paper, Stack, TextField, Typography } from '@mui/material';
import {
  DOCX_MIME,
  JD_BYTES,
  JD_UNITS,
  jdBytes,
  validateFile,
  validateJd,
} from './analysis-validation';
import type { FormErrors } from './analysis-validation';
interface Props {
  busy: boolean;
  onStart: (file: File, text: string, parseOnly: boolean) => void;
  onEdit: () => void;
  onCancel: () => void;
  onClear: () => void;
}
export function AnalysisForm({
  busy,
  onStart,
  onEdit,
  onCancel,
  onClear,
}: Props) {
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const jdInput = useRef<HTMLTextAreaElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [jdText, setJdText] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  return (
    <Paper
      component="form"
      aria-label="Local analysis"
      variant="outlined"
      noValidate
      sx={{ p: { xs: 2, md: 3 } }}
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        const cv = validateFile(files);
        const jd = validateJd(jdText);
        setErrors({ cv, jdText: jd });
        if (cv) {
          fileInput.current?.focus();
          return;
        }
        if (jd) {
          jdInput.current?.focus();
          return;
        }
        const submitter = (event.nativeEvent as SubmitEvent).submitter;
        onStart(
          files[0]!,
          jdText,
          submitter?.getAttribute('value') === 'parse-only',
        );
      }}
    >
      <Stack spacing={2}>
        <Typography component="h2" variant="h6">
          Analyze a CV and job description
        </Typography>
        <label htmlFor={`${id}-cv`}>CV file (PDF or DOCX)</label>
        <input
          ref={fileInput}
          id={`${id}-cv`}
          type="file"
          accept={`.pdf,.docx,application/pdf,${DOCX_MIME}`}
          disabled={busy}
          aria-invalid={Boolean(errors.cv)}
          aria-describedby={`${id}-cv-help`}
          style={{ maxWidth: '100%' }}
          onChange={(event) => {
            const selected = Array.from(event.target.files ?? []);
            setFiles(selected);
            setErrors((current) => ({
              ...current,
              cv: validateFile(selected),
            }));
            onEdit();
          }}
        />
        <Typography
          id={`${id}-cv-help`}
          variant="body2"
          color={errors.cv ? 'error' : 'text.secondary'}
        >
          {errors.cv ??
            'Exactly one nonempty PDF or DOCX, maximum 5 MiB. File metadata must match its extension.'}
        </Typography>
        <TextField
          label="Job description"
          multiline
          minRows={6}
          fullWidth
          disabled={busy}
          value={jdText}
          inputRef={jdInput}
          error={Boolean(errors.jdText)}
          helperText={
            errors.jdText ??
            'Paste the original JD. Whitespace is preserved; some characters count as two UTF-16 units.'
          }
          slotProps={{
            htmlInput: {
              'aria-describedby': `${id}-counts ${id}-jd-helper-text`,
            },
          }}
          id={`${id}-jd`}
          onChange={(event) => {
            setJdText(event.target.value);
            setErrors((current) => ({
              ...current,
              jdText: validateJd(event.target.value),
            }));
            onEdit();
          }}
        />
        <Typography id={`${id}-counts`} variant="body2">
          JD length: {jdText.length.toLocaleString('en-US')} /{' '}
          {JD_UNITS.toLocaleString('en-US')} UTF-16 units;{' '}
          {jdBytes(jdText).toLocaleString('en-US')} /{' '}
          {JD_BYTES.toLocaleString('en-US')} UTF-8 bytes.
        </Typography>
        <Typography variant="body2">
          Analyze runs local AI for basic facts only. It does not generate a
          matching score.
        </Typography>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Button
            type="submit"
            value="parse-only"
            variant="outlined"
            disabled={busy}
          >
            Parse without AI
          </Button>
          <Button
            startIcon={<AutoAwesomeIcon />}
            type="submit"
            variant="contained"
            disabled={busy}
          >
            Analyze
          </Button>
          <Button type="button" disabled={!busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              setFiles([]);
              setJdText('');
              setErrors({});
              if (fileInput.current) fileInput.current.value = '';
              onClear();
            }}
          >
            Clear
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
