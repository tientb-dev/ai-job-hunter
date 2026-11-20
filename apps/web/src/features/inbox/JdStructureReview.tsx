import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { tr } from '../../app/i18n';
import { useNotify } from '../../components/useNotify';
import { opportunityRequest } from './opportunities-api';

type Role = '' | 'mandatory' | 'alternatives' | 'contextual';
type Priority = 'required' | 'preferred';
type Requirement = {
  id: string;
  reason: string | null;
  eligible: boolean;
  priority: Priority | 'unknown';
  alternatives: string | null;
  namedAlternatives?: string[];
  sources: { source: { field: string; quote: string } }[];
  candidates: { canonical: string | null; literal: string }[];
  confirmation?: { mandatory: string[]; alternatives: string[] };
};
type InventoryResponse = {
  state: string;
  inventory: { id: string; requirements: Requirement[] } | null;
};

export function JdStructureReview(props: {
  jobId: string;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  return open ? (
    <StructureReviewForm {...props} />
  ) : (
    <Button onClick={() => setOpen(true)} sx={{ alignSelf: 'flex-start' }}>
      {tr('Review ambiguous JD structure')}
    </Button>
  );
}

function StructureReviewForm({
  jobId,
  onSaved,
}: {
  jobId: string;
  onSaved: () => void;
}) {
  const notify = useNotify();
  const path = `/${jobId}/jd-skill-inventory`;
  const [data, setData] = useState<InventoryResponse>();
  const [group, setGroup] = useState<Requirement>();
  const [roles, setRoles] = useState<Record<string, Role>>({});
  const [mandatoryPriority, setMandatory] = useState<Priority | ''>('required');
  const [alternativePriority, setAlternative] = useState<Priority | ''>(
    'required',
  );
  const [busy, setBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void opportunityRequest<InventoryResponse>(path).then(
      (inventory) => {
        if (active) setData(inventory);
      },
      () => {
        if (active) setLoadFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [path]);

  async function load(refresh = false) {
    setBusy(true);
    setLoadFailed(false);
    try {
      setData(
        await opportunityRequest<InventoryResponse>(
          refresh ? `${path}/refresh` : path,
          refresh ? { method: 'POST' } : undefined,
        ),
      );
      setGroup(undefined);
      if (refresh) {
        notify({ severity: 'success', text: tr('JD inventory refreshed.') });
        onSaved();
      }
    } catch {
      if (refresh)
        notify({
          severity: 'error',
          text: tr('Could not refresh the JD inventory.'),
        });
      else setLoadFailed(true);
    } finally {
      setBusy(false);
    }
  }

  function select(next: Requirement) {
    setGroup(next);
    setRoles(
      Object.fromEntries(
        (next.namedAlternatives ?? []).map((name) => [name, 'alternatives']),
      ),
    );
    setMandatory(next.priority === 'unknown' ? '' : next.priority);
    setAlternative(next.priority === 'unknown' ? '' : next.priority);
  }

  const mandatory = Object.keys(roles).filter(
    (name) => roles[name] === 'mandatory',
  );
  const alternatives = Object.keys(roles).filter(
    (name) => roles[name] === 'alternatives',
  );
  const open =
    group?.alternatives === 'OPEN_ENDED' ||
    group?.alternatives === 'NAMED_WITH_FALLBACK';
  const assessedCount = mandatory.length + Number(alternatives.length > 0);

  async function confirm() {
    if (!group || !data?.inventory) return;
    setBusy(true);
    try {
      setData(
        await opportunityRequest<InventoryResponse>(`${path}/confirm`, {
          method: 'POST',
          body: JSON.stringify({
            inventoryId: data.inventory.id,
            groupId: group.id,
            mandatory,
            alternatives,
            contextual: Object.keys(roles).filter(
              (name) => roles[name] === 'contextual',
            ),
            mandatoryPriority: mandatoryPriority || 'required',
            alternativePriority: alternativePriority || 'required',
          }),
        }),
      );
      setGroup(undefined);
      notify({ severity: 'success', text: tr('JD structure confirmed.') });
      onSaved();
    } catch {
      notify({
        severity: 'error',
        title: tr('Could not confirm JD structure'),
        text: tr(
          'Check the selected branches or reload the JD inventory and try again.',
        ),
      });
    } finally {
      setBusy(false);
    }
  }

  const groups = data?.inventory?.requirements.filter(
    (item) =>
      item.reason === 'AMBIGUOUS_GROUP' &&
      !item.eligible &&
      item.candidates.some(({ canonical }) => canonical),
  );
  const names = [
    ...new Set(
      group?.candidates
        .map(({ canonical }) => canonical)
        .filter((name): name is string => name !== null),
    ),
  ];
  const loading = !data && !loadFailed;
  const sourceText = (item: Requirement) =>
    item.sources.find(({ source }) =>
      ['description', 'jdText', 'postText'].includes(source.field),
    )?.source.quote ?? item.sources[0]?.source.quote;
  return (
    <Stack spacing={1.5} sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
      <Button
        disabled={busy || loading}
        onClick={() => void load()}
        sx={{ alignSelf: 'flex-start' }}
      >
        {tr('Reload JD structure')}
      </Button>
      {loading && (
        <Typography role="status" variant="body2">
          {tr('Loading JD inventory…')}
        </Typography>
      )}
      {loadFailed && (
        <Alert severity="error">
          {tr('Could not load the JD inventory. Try again.')}
        </Alert>
      )}
      {data && ['MISSING', 'STALE', 'FAILED'].includes(data.state) && (
        <Button
          disabled={busy}
          onClick={() => void load(true)}
          sx={{ alignSelf: 'flex-start' }}
        >
          {tr('Refresh JD inventory')}
        </Button>
      )}
      {data?.inventory && !groups?.length && (
        <Typography variant="body2">
          {tr('No ambiguous groups available to confirm.')}
        </Typography>
      )}
      {data?.inventory?.requirements
        .filter((item) => item.confirmation)
        .map((item) => (
          <Typography key={item.id} variant="body2">
            {tr('Confirmed JD structure')}
            {' · '}
            {item.confirmation!.mandatory.join(' + ')}
            {item.confirmation!.mandatory.length > 0 &&
              item.confirmation!.alternatives.length > 0 &&
              ' + '}
            {item.confirmation!.alternatives.join(' / ')}
          </Typography>
        ))}
      {!!groups?.length && (
        <TextField
          select
          size="small"
          label={tr('Ambiguous requirement')}
          sx={{
            minWidth: 0,
            '& .MuiSelect-select': { textOverflow: 'ellipsis' },
          }}
          value={group?.id ?? ''}
          disabled={busy}
          onChange={(event) => {
            const next = groups.find((item) => item.id === event.target.value);
            if (next) select(next);
          }}
        >
          {groups.map((item) => (
            <MenuItem
              key={item.id}
              value={item.id}
              sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}
            >
              {sourceText(item)}
            </MenuItem>
          ))}
        </TextField>
      )}
      {group && (
        <Stack spacing={1.5} sx={{ minWidth: 0 }}>
          <Typography
            component="blockquote"
            variant="body2"
            sx={{
              m: 0,
              p: 1.5,
              borderLeft: '2px solid',
              borderColor: 'divider',
              whiteSpace: 'pre-wrap',
            }}
          >
            {sourceText(group)}
          </Typography>
          <Typography variant="body2">
            {tr(
              'Check the source and assign every listed skill. Mark a skill as context only if it is outside the requirement.',
            )}
          </Typography>
          {names.map((name) => (
            <TextField
              select
              size="small"
              label={name}
              key={name}
              value={roles[name] ?? ''}
              disabled={busy || group.namedAlternatives?.includes(name)}
              onChange={(event) =>
                setRoles({ ...roles, [name]: event.target.value as Role })
              }
            >
              <MenuItem value="">{tr('Unassigned')}</MenuItem>
              <MenuItem value="mandatory">
                {tr('Each selected skill is required')}
              </MenuItem>
              <MenuItem value="contextual">{tr('Context only')}</MenuItem>
              <MenuItem value="alternatives">
                {tr('Any one option is sufficient')}
              </MenuItem>
            </TextField>
          ))}
          {!!mandatory.length && (
            <TextField
              select
              size="small"
              label={tr('Mandatory branch priority')}
              value={mandatoryPriority}
              disabled={busy}
              onChange={(e) => setMandatory(e.target.value as Priority)}
            >
              <MenuItem value="required">{tr('Required')}</MenuItem>
              <MenuItem value="preferred">{tr('Preferred')}</MenuItem>
            </TextField>
          )}
          {!!alternatives.length && (
            <TextField
              select
              size="small"
              label={tr('Alternative branch priority')}
              value={alternativePriority}
              disabled={busy}
              onChange={(e) => setAlternative(e.target.value as Priority)}
            >
              <MenuItem value="required">{tr('Required')}</MenuItem>
              <MenuItem value="preferred">{tr('Preferred')}</MenuItem>
            </TextField>
          )}
          {open && (
            <Typography variant="body2">
              {tr(
                'The source fallback stays open for review when no named option matches.',
              )}
            </Typography>
          )}
          <Typography variant="body2">
            {tr('Proposed additional assessed groups: {n}', {
              n: assessedCount,
            })}
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button
              variant="contained"
              disabled={
                busy ||
                !assessedCount ||
                (!!mandatory.length && !mandatoryPriority) ||
                (!!alternatives.length && !alternativePriority) ||
                names.some((name) => !roles[name]) ||
                (open ? !alternatives.length : alternatives.length === 1)
              }
              onClick={() => void confirm()}
            >
              {tr('Confirm interpretation')}
            </Button>
            <Button disabled={busy} onClick={() => setGroup(undefined)}>
              {tr('Leave unresolved')}
            </Button>
          </Stack>
        </Stack>
      )}
    </Stack>
  );
}
