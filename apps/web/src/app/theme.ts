import { createTheme } from '@mui/material/styles';

// Shared surface tokens: panels, dialogs and menus share one radius; controls
// (buttons, fields, alerts) keep the tighter shape radius.
export const surface = {
  radius: 8,
  controlRadius: 6,
  controlBorder: '#c9cac3',
  // Panel outline: a step darker than divider so white panels read clearly on
  // the tinted page without shadows.
  panelBorder: '#dcdcd5',
} as const;

// Ledger: neutral surfaces and one ink-blue accent. Status colors keep MUI's
// defaults, whose filled-Chip contrast is covered by semantic-contrast tests.
export const theme = createTheme({
  palette: {
    primary: { main: '#2f5bd3', dark: '#2447a8', contrastText: '#ffffff' },
    background: { default: '#f0f0eb', paper: '#ffffff' },
    text: { primary: '#16181d', secondary: '#575c69' },
    divider: '#e3e3dd',
    action: { hover: '#f0f0ec', selected: '#eceef3' },
  },
  spacing: 8,
  shape: { borderRadius: surface.controlRadius },
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
        // The gutter above already holds the scrollbar's space, so MUI's scroll
        // lock padding (added when a menu or dialog opens) would shift the page.
        body: {
          fontVariantNumeric: 'tabular-nums',
          paddingRight: '0 !important',
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: surface.controlRadius,
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
        outlined: ({ theme }) => ({
          borderRadius: surface.radius,
          borderColor: surface.panelBorder,
          // Panels nested inside a panel keep the lighter divider outline.
          '& .MuiPaper-outlined': { borderColor: theme.palette.divider },
        }),
      },
    },
    // Compact form controls everywhere: 40px single-line fields from sm up,
    // 44px on phones (touch targets). TextField covers selects, dates and
    // multiline fields; per-page size props are not needed.
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiFormControl: { defaultProps: { size: 'small' } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: surface.controlRadius,
          backgroundColor: theme.palette.background.paper,
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: surface.controlBorder,
          },
          '&:hover:not(.Mui-disabled):not(.Mui-error) .MuiOutlinedInput-notchedOutline':
            { borderColor: theme.palette.text.secondary },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderWidth: 2 },
          // 9.25px padding + 15px text = 40px; 11.25px = 44px on phones.
          '&.MuiInputBase-sizeSmall:not(.MuiInputBase-multiline) .MuiOutlinedInput-input':
            {
              paddingTop: 9.25,
              paddingBottom: 9.25,
              [theme.breakpoints.down('sm')]: {
                paddingTop: 11.25,
                paddingBottom: 11.25,
              },
            },
        }),
      },
    },
    // Labels keep MUI's 1rem size so the shrunk label stays 12px.
    MuiInputLabel: {
      styleOverrides: {
        sizeSmall: ({ theme }) => ({
          [theme.breakpoints.down('sm')]: {
            '&:not(.MuiInputLabel-shrink)': {
              transform: 'translate(14px, 11px) scale(1)',
            },
          },
        }),
      },
    },
    MuiFormHelperText: {
      styleOverrides: {
        root: {
          marginTop: 4,
          marginLeft: 2,
          marginRight: 2,
          fontSize: '0.8125rem',
          lineHeight: 1.45,
        },
      },
    },
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
    MuiAlert: {
      styleOverrides: { root: { borderRadius: surface.controlRadius } },
    },
    MuiDialog: {
      styleOverrides: { paper: { borderRadius: surface.radius } },
    },
    MuiPopover: {
      styleOverrides: { paper: { borderRadius: surface.radius } },
    },
    MuiTab: {
      styleOverrides: {
        root: { textTransform: 'none', fontWeight: 500, minHeight: 44 },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: { textTransform: 'none', borderRadius: surface.controlRadius },
      },
    },
  },
});
