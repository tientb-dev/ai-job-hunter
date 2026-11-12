import { createTheme } from '@mui/material/styles';

// Ledger: neutral surfaces and one ink-blue accent. Status colors keep MUI's
// defaults, whose filled-Chip contrast is covered by semantic-contrast tests.
export const theme = createTheme({
  palette: {
    primary: { main: '#2f5bd3', dark: '#2447a8', contrastText: '#ffffff' },
    background: { default: '#f6f6f3', paper: '#ffffff' },
    text: { primary: '#16181d', secondary: '#575c69' },
    divider: '#e3e3dd',
    action: { hover: '#f0f0ec', selected: '#eceef3' },
  },
  spacing: 8,
  shape: { borderRadius: 6 },
  typography: {
    fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
    h4: { fontSize: '1.5rem', fontWeight: 600, lineHeight: 1.3 },
    // Preserve the existing section/body metrics used by CV Match.
    h6: { fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.5 },
    subtitle1: { fontSize: '1rem', fontWeight: 400, lineHeight: 1.6 },
    subtitle2: { fontSize: '0.875rem', fontWeight: 500, lineHeight: 1.57 },
    body1: { fontSize: '0.9375rem', lineHeight: 1.5 },
    body2: { fontSize: '0.875rem', lineHeight: 1.45 },
    caption: { fontSize: '0.75rem', lineHeight: 1.6 },
    button: { textTransform: 'none', fontWeight: 500 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        // Reserve the page scrollbar's space so content doesn't shift when it appears.
        html: { scrollbarGutter: 'stable' },
        body: { fontVariantNumeric: 'tabular-nums' },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: 6,
          '&.Mui-focusVisible': {
            outline: `2px solid ${theme.palette.primary.main}`,
            outlineOffset: 2,
          },
        }),
        // Neutral outline; color="error" marks a destructive action, which stays
        // neutral at rest and turns red on hover and keyboard focus (ux-guidelines).
        outlined: ({ theme, ownerState }) => {
          const error = ownerState.color === 'error';
          const danger = {
            borderColor: theme.palette.error.main,
            color: theme.palette.error.main,
            backgroundColor: theme.palette.background.paper,
          };
          return {
            borderColor: theme.palette.divider,
            color: theme.palette.text.primary,
            backgroundColor: theme.palette.background.paper,
            '&:hover': error
              ? danger
              : {
                  borderColor: theme.palette.text.secondary,
                  backgroundColor: theme.palette.action.hover,
                },
            ...(error && {
              '&.Mui-focusVisible': {
                ...danger,
                outline: `2px solid ${theme.palette.error.main}`,
                outlineOffset: 2,
              },
            }),
          };
        },
        // Touch targets: at least 44px on phones, compact sizes from sm up.
        sizeSmall: ({ theme }) => ({
          minHeight: 32,
          [theme.breakpoints.down('sm')]: { minHeight: 44 },
        }),
        sizeMedium: ({ theme }) => ({
          minHeight: 36,
          [theme.breakpoints.down('sm')]: { minHeight: 44 },
        }),
        sizeLarge: { minHeight: 44 },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: ({ theme }) => ({
          [theme.breakpoints.down('sm')]: { minWidth: 44, minHeight: 44 },
          '&.Mui-focusVisible': {
            outline: `2px solid ${theme.palette.primary.main}`,
            outlineOffset: 2,
          },
        }),
      },
    },
    MuiPaper: {
      styleOverrides: {
        outlined: { borderRadius: 8 },
      },
    },
    MuiOutlinedInput: { styleOverrides: { root: { borderRadius: 6 } } },
    MuiChip: {
      styleOverrides: {
        root: ({ theme }) => ({
          fontWeight: 500,
          // Keep the warning fill; only filled warning indicators need dark text.
          '&.MuiChip-filled.MuiChip-colorWarning': {
            color: theme.palette.grey[900],
          },
        }),
      },
    },
    MuiAlert: { styleOverrides: { root: { borderRadius: 6 } } },
    MuiTab: {
      styleOverrides: {
        root: { textTransform: 'none', fontWeight: 500, minHeight: 44 },
      },
    },
    MuiToggleButton: {
      styleOverrides: { root: { textTransform: 'none', borderRadius: 6 } },
    },
  },
});
