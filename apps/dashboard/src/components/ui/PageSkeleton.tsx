import { Box, Skeleton } from '@mui/material';

/**
 * The shape of a page, before we know whether it may be shown.
 *
 * Used by the route guard while permissions resolve. A spinner would be the
 * easier thing to reach for and is the wrong tool: the page's layout is known
 * in advance, and a skeleton spends that knowledge on telling the reader what
 * is arriving instead of only that something is.
 *
 * It also removes the flash the alternative causes. Rendering the not-found
 * page while permissions are still in flight shows every user a "no such page"
 * for one frame on every navigation, which teaches them the app is broken.
 */
export default function PageSkeleton() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Page heading and its primary action. */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          justifyContent: 'space-between',
          alignItems: { xs: 'flex-start', sm: 'center' },
          gap: 2,
        }}
      >
        <Box sx={{ width: '100%', maxWidth: 360 }}>
          <Skeleton variant="text" width="55%" sx={{ fontSize: '2rem' }} />
          <Skeleton variant="text" width="80%" sx={{ fontSize: '0.875rem' }} />
        </Box>
        <Skeleton variant="rounded" width={148} height={40} sx={{ borderRadius: 2.5 }} />
      </Box>

      {/* A row of summary cards, equal height — the same rule the real cards
          follow, so nothing shifts when they arrive. */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 2,
        }}
      >
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={`card-${i}`} variant="rounded" height={128} sx={{ borderRadius: 3.5 }} />
        ))}
      </Box>

      {/* The body: a table or a list. Rows fade slightly down the block so it
          reads as content trailing off rather than as a placeholder grid. */}
      <Skeleton variant="rounded" height={56} sx={{ borderRadius: 3 }} />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton
            key={`row-${i}`}
            variant="rounded"
            height={52}
            sx={{ borderRadius: 2.5, opacity: 1 - i * 0.11 }}
          />
        ))}
      </Box>
    </Box>
  );
}
