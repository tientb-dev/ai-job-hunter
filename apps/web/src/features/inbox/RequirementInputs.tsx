import { tr } from '../../app/i18n';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Stack, TextField } from '@mui/material';
const categories = ['technical', 'education', 'language', 'other'] as const;
type Category = (typeof categories)[number];
type Groups = Record<Category, string>;
function groupRequirements(value: string): Groups {
  const groups: Record<Category, string[]> = {
    technical: [],
    education: [],
    language: [],
    other: [],
  };
  for (const line of value.split('\n').filter((line) => line.trim())) {
    const category =
      /\b(?:bachelor|master|degree|education|university|college)\b|đại học|học viện/iu.test(
        line,
      )
        ? 'education'
        : /\b(?:English|TOEIC|IELTS|language proficiency)\b|ngoại ngữ/iu.test(
              line,
            )
          ? 'language'
          : /\b(?:autonomy|proactive|problem-solving|eagerness|collaboration|teamwork|security mindset|willingness to support)\b/iu.test(
                line,
              )
            ? 'other'
            : 'technical';
    groups[category].push(line);
  }
  return Object.fromEntries(
    categories.map((category) => [category, groups[category].join('\n')]),
  ) as Groups;
}
// Separate presentation, one canonical persisted requirements value. Classification
// runs for incoming suggestions, not while the user is typing in a group.
export function RequirementInputs({
  label,
  value,
  onChange,
  error,
  helperText,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error: boolean;
  helperText?: ReactNode;
  maxLength: number;
}) {
  const [groups, setGroups] = useState(() => groupRequirements(value));
  const [shown, setShown] = useState(() =>
    categories.filter(
      (category) => category === 'technical' || groups[category],
    ),
  );
  const emitted = useRef(value);
  useEffect(() => {
    if (value !== emitted.current) {
      emitted.current = value;
      const next = groupRequirements(value);
      setGroups(next);
      setShown(
        categories.filter(
          (category) => category === 'technical' || next[category],
        ),
      );
    }
  }, [value]);
  const prefix = label.startsWith('Preferred') ? 'Preferred' : 'Required';
  const labels: Record<Category, string> = {
    technical: label,
    education: tr('{prefix} education requirements', { prefix: prefix }),
    language: tr('{prefix} language requirements', { prefix: prefix }),
    other: tr('{prefix} collaboration and soft-skill requirements', {
      prefix: prefix,
    }),
  };
  return (
    <Stack spacing={2}>
      {shown.map((category) => (
        <TextField
          key={category}
          label={labels[category]}
          value={groups[category]}
          multiline
          minRows={2}
          maxRows={8}
          placeholder={tr('Unknown')}
          error={error}
          helperText={
            category === 'technical'
              ? helperText
              : tr(
                  'Preserved as a qualification, separately from technical skills.',
                )
          }
          slotProps={{
            htmlInput: {
              maxLength: Math.max(
                0,
                maxLength -
                  categories
                    .filter((other) => other !== category && groups[other])
                    .reduce((sum, other) => sum + groups[other].length + 1, 0),
              ),
            },
          }}
          onChange={(event) => {
            const next = { ...groups, [category]: event.target.value };
            const combined = categories
              .map((key) => next[key])
              .filter(Boolean)
              .join('\n');
            emitted.current = combined;
            setGroups(next);
            onChange(combined);
          }}
        />
      ))}
    </Stack>
  );
}
