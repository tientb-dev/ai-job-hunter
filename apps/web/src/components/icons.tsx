import { createSvgIcon } from '@mui/material/utils';

// Material (filled) glyphs on a 24px grid, shared so each shape exists once.
// SvgIcon hides itself from assistive technology unless titleAccess is set.
export const CloseIcon = createSvgIcon(
  <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />,
  'Close',
);
export const CheckIcon = createSvgIcon(
  <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />,
  'Check',
);
export const ArrowBackIcon = createSvgIcon(
  <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />,
  'ArrowBack',
);
export const ExpandMoreIcon = createSvgIcon(
  <path d="M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z" />,
  'ExpandMore',
);
export const MenuIcon = createSvgIcon(
  <path d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z" />,
  'Menu',
);
export const OpenInNewIcon = createSvgIcon(
  <path d="M14 3h7v7h-2V6.4l-9.3 9.3-1.4-1.4L17.6 5H14V3zM5 5h6v2H5v12h12v-6h2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />,
  'OpenInNew',
);
export const MicIcon = createSvgIcon(
  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3m5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72z" />,
  'Mic',
);
export const StopIcon = createSvgIcon(<path d="M6 6h12v12H6z" />, 'Stop');
export const PlayIcon = createSvgIcon(<path d="M8 5v14l11-7z" />, 'Play');
export const AddIcon = createSvgIcon(
  <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z" />,
  'Add',
);
export const SearchIcon = createSvgIcon(
  <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14" />,
  'Search',
);

// Main navigation.
export const DashboardIcon = createSvgIcon(
  <path d="M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z" />,
  'Dashboard',
);
export const WorkIcon = createSvgIcon(
  <path d="M20 6h-4V4c0-1.11-.89-2-2-2h-4c-1.11 0-2 .89-2 2v2H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2m-6 0h-4V4h4z" />,
  'Work',
);
export const ExploreIcon = createSvgIcon(
  <path d="M12 10.9c-.61 0-1.1.49-1.1 1.1s.49 1.1 1.1 1.1 1.1-.49 1.1-1.1-.49-1.1-1.1-1.1M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m2.19 12.19L6 18l3.81-8.19L18 6z" />,
  'Explore',
);
export const DescriptionIcon = createSvgIcon(
  <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8zm2 16H8v-2h8zm0-4H8v-2h8zm-3-5V3.5L18.5 9z" />,
  'Description',
);
export const ForumIcon = createSvgIcon(
  <path d="M21 6h-2v9H6v2c0 .55.45 1 1 1h11l4 4V7c0-.55-.45-1-1-1m-4 6V3c0-.55-.45-1-1-1H3c-.55 0-1 .45-1 1v14l4-4h10c.55 0 1-.45 1-1" />,
  'Forum',
);
