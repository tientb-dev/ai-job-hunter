import { useLayoutEffect, useRef, useState } from 'react';
import { DiscoveryQueue } from './DiscoveryQueue';
import { Stack, useTheme } from '@mui/material';
import { PageHeader } from '../../components/PageHeader';
import { DiscoverJobs } from './DiscoverJobs';

export function DiscoverJobsPage({
  onViewportLayoutChange,
}: {
  onViewportLayoutChange?: (bounded: boolean) => void;
}) {
  const [revision, setRevision] = useState(0);
  const [bounded, setBounded] = useState(false);
  const page = useRef<HTMLDivElement>(null);
  const chrome = useRef<HTMLDivElement>(null);
  const theme = useTheme();
  useLayoutEffect(() => {
    const root = page.current;
    const header = chrome.current;
    if (!root || !header) return;
    const controls = [
      ...root.querySelectorAll<HTMLElement>('[data-queue-chrome]'),
    ];
    const measure = () => {
      const rem =
        parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const gap = parseFloat(getComputedStyle(root).rowGap) || 16;
      const main = root.closest('main');
      const bottomPadding = main
        ? parseFloat(getComputedStyle(main).paddingBottom) || 0
        : 0;
      const available =
        window.innerHeight -
        (root.getBoundingClientRect().top + window.scrollY) -
        header.getBoundingClientRect().height -
        gap -
        bottomPadding -
        controls.reduce(
          (height, element) => height + element.getBoundingClientRect().height,
          0,
        ) -
        2;
      // Leave a usable row area; expanded controls, short windows and zoom fall back
      // to document scrolling rather than clipping controls or nesting tiny scrollers.
      const fits =
        window.innerWidth >= theme.breakpoints.values.md &&
        available >= 12 * rem;
      setBounded(fits);
      onViewportLayoutChange?.(fits);
    };
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(measure);
    [root, header, ...controls].forEach((element) =>
      observer?.observe(element),
    );
    window.addEventListener('resize', measure);
    measure();
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [theme.breakpoints.values.md, onViewportLayoutChange]);
  return (
    <Stack
      ref={page}
      spacing={2}
      sx={{ flex: bounded ? 1 : undefined, minHeight: 0, minWidth: 0 }}
    >
      <Stack
        ref={chrome}
        data-discovery-chrome
        spacing={2}
        sx={{ flexShrink: 0 }}
      >
        <PageHeader title="Discover jobs" />
        <DiscoverJobs onDiscovered={() => setRevision((value) => value + 1)} />
      </Stack>
      <DiscoveryQueue revision={revision} bounded={bounded} />
    </Stack>
  );
}
