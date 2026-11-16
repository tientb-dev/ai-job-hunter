import type { ReactNode } from 'react';
import { Box, Stack, Typography } from '@mui/material';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

// The shell owns horizontal gutters; this component adds no nested padding.
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={2}
      sx={{
        minWidth: 0,
        alignItems: { xs: 'flex-start', sm: 'center' },
        justifyContent: 'space-between',
      }}
    >
      <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
        <Typography variant="h4" component="h1">
          {title}
        </Typography>
        {description && (
          <Typography color="text.secondary" sx={{ mt: 0.5, maxWidth: '72ch' }}>
            {description}
          </Typography>
        )}
      </Box>
      {actions && (
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ flexShrink: 0, flexWrap: 'wrap', maxWidth: '100%' }}
        >
          {actions}
        </Stack>
      )}
    </Stack>
  );
}
