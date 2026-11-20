import { createTheme, keyframes } from '@mui/material/styles';

// Shared first-render entrance (fade + 6px rise); the reduced-motion rule below turns it off.
const rise = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
`;
export const enter = (step = 0) => ({
  animation: `${rise} 260ms ease-out both`,
  animationDelay: `${step * 50}ms`,
});

// Shared surface tokens: panels, dialogs and menus share one radius; controls
// (buttons, fields, alerts) keep the tighter shape radius.
export const surface = {
  radius: 12,
  controlRadius: 8,
  controlBorder: '#c7d0dd',
  neutralButtonBorder: '#7c8ba1',
  // Panel outline: a step darker than divider so white panels read on the blue-tinted page.
  panelBorder: '#dce3ee',
  // Pale primary for selected navigation and progress tracks.
  primaryTint: '#eff4ff',
  // Static shadows only: animating shadows repaints whole lists.
  panelShadow: '0 1px 2px rgba(23, 43, 77, 0.06)',
  overlayShadow: '0 8px 24px rgba(23, 43, 77, 0.12)',
} as const;

// Modern SaaS Blue: cool neutral surfaces and one blue accent. Status colors keep
// MUI's defaults, whose filled-Chip contrast is covered by semantic-contrast tests.
export const theme = createTheme({
  palette: {
    primary: {
      main: '#2563eb',
      dark: '#1d4ed8',
      contrastText: '#ffffff',
    },
    background: { default: '#f5f8ff', paper: '#ffffff' },
    text: { primary: '#172b4d', secondary: '#5e6c84' },
    divider: '#e4e9f2',
    action: { hover: '#f0f4fb', selected: '#e8effd' },
  },
  spacing: 8,
  shape: { borderRadius: surface.controlRadius },
  typography: {
    fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
    h4: {
      fontSize: '1.5rem',
      fontWeight: 600,
      lineHeight: 1.3,
      letterSpacing: '-0.01em',
    },
    // Preserve the existing section/body metrics used by CV Match.
    h6: { fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.5 },
    subtitle1: { fontSize: '1rem', fontWeight: 400, lineHeight: 1.6 },
    subtitle2: { fontSize: '0.875rem', fontWeight: 500, lineHeight: 1.57 },
    body1: { fontSize: '0.9375rem', lineHeight: 1.5 },
    body2: { fontSize: '0.875rem', lineHeight: 1.45 },
    caption: { fontSize: '0.75rem', lineHeight: 1.6 },
    button: { textTransform: 'none', fontWeight: 500 },
    overline: { fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.06em' },
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
        // Honor reduced motion for MUI transitions and any CSS animation.
        '@media (prefers-reduced-motion: reduce)': {
          '*, *::before, *::after': {
            animationDuration: '0.01ms !important',
            animationDelay: '0s !important',
            animationIterationCount: '1 !important',
            transitionDuration: '0.01ms !important',
            scrollBehavior: 'auto !important',
          },
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
        // Explicit secondary actions use the blue outline. Default and error
        // actions keep their neutral and destructive treatments.
        outlined: ({ theme, ownerState }) => {
          const { primary, action, text } = theme.palette;
          const disabled = {
            borderColor: surface.controlBorder,
            color: text.secondary,
            backgroundColor: action.hover,
          };
          if (ownerState.color === 'secondary') {
            return {
              borderColor: primary.main,
              color: primary.dark,
              backgroundColor: surface.primaryTint,
              '&:hover': {
                borderColor: primary.dark,
                backgroundColor: action.selected,
              },
              '&.Mui-disabled': disabled,
            };
          }
          const error = ownerState.color === 'error';
          const danger = {
            borderColor: theme.palette.error.main,
            color: theme.palette.error.main,
            backgroundColor: theme.palette.background.paper,
          };
          return {
            borderColor: surface.neutralButtonBorder,
            color: text.primary,
            backgroundColor: theme.palette.background.paper,
            '&:hover': error
              ? danger
              : {
                  borderColor: theme.palette.text.secondary,
                  backgroundColor: action.hover,
                },
            '&.Mui-disabled': disabled,
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
          boxShadow: surface.panelShadow,
          // Panels nested inside a panel keep the lighter divider outline, flat.
          '& .MuiPaper-outlined': {
            borderColor: theme.palette.divider,
            boxShadow: 'none',
          },
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
      styleOverrides: {
        paper: {
          borderRadius: surface.radius,
          boxShadow: surface.overlayShadow,
        },
      },
    },
    MuiPopover: {
      styleOverrides: {
        paper: {
          borderRadius: surface.radius,
          boxShadow: surface.overlayShadow,
          border: `1px solid ${surface.panelBorder}`,
        },
      },
    },
    // Skeletons match the cool palette instead of MUI's grey.
    MuiSkeleton: {
      styleOverrides: { root: { backgroundColor: '#e8edf5' } },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: { borderRadius: 999, backgroundColor: surface.primaryTint },
      },
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
