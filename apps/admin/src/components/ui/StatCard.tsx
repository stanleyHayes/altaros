import type { ReactNode } from 'react';
import { Box, Card, CardContent, Typography } from '@mui/material';
import { ArrowDownwardRounded, ArrowUpwardRounded } from '@mui/icons-material';

type StatCardProps = {
  title: string;
  value: string | number;
  icon: ReactNode;
  change?: number;
  changeLabel?: string;
  featured?: boolean;
};

export default function StatCard({
  title,
  value,
  icon,
  change,
  changeLabel,
  featured = false,
}: StatCardProps) {
  const positive = (change ?? 0) >= 0;

  return (
    <Card
      sx={{
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        isolation: 'isolate',
        bgcolor: featured ? 'primary.main' : 'background.paper',
        color: featured ? 'primary.contrastText' : 'text.primary',
        borderColor: featured ? 'transparent' : 'divider',
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: '0 auto 0 0',
          width: 3,
          bgcolor: featured ? 'rgba(7,27,25,.42)' : 'primary.main',
        },
      }}
    >
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          right: -20,
          bottom: -28,
          zIndex: 0,
          color: featured ? '#071B19' : 'primary.main',
          opacity: featured ? 0.1 : 0.07,
          transform: 'rotate(-9deg)',
          pointerEvents: 'none',
          '& .MuiSvgIcon-root': { fontSize: 132 },
        }}
      >
        {icon}
      </Box>
      <CardContent
        sx={{
          height: '100%',
          minHeight: 184,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
          <Typography
            variant="overline"
            sx={{ color: featured ? 'rgba(7,27,25,.62)' : 'text.secondary' }}
          >
            {title}
          </Typography>
          <Box
            sx={{
              width: 38,
              height: 38,
              borderRadius: 1,
              border: '1px solid',
              borderColor: featured ? 'rgba(7,27,25,.12)' : 'rgba(113,215,197,.16)',
              bgcolor: featured ? 'rgba(7,27,25,.08)' : 'rgba(113,215,197,.07)',
              color: featured ? 'inherit' : 'primary.main',
              display: 'grid',
              placeItems: 'center',
              '& .MuiSvgIcon-root': { fontSize: 20 },
            }}
          >
            {icon}
          </Box>
        </Box>
        <Typography
          sx={{
            mt: 2.4,
            fontSize: 'clamp(1.8rem,3vw,2.65rem)',
            fontWeight: 760,
            letterSpacing: '-.05em',
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {value}
        </Typography>
        {change !== undefined && (
          <Box sx={{ mt: 'auto', pt: 2, display: 'flex', alignItems: 'center', gap: 0.6 }}>
            {positive ? (
              <ArrowUpwardRounded
                sx={{ fontSize: 15, color: featured ? 'inherit' : 'success.main' }}
              />
            ) : (
              <ArrowDownwardRounded sx={{ fontSize: 15, color: 'error.main' }} />
            )}
            <Typography
              sx={{
                fontSize: '.68rem',
                fontWeight: 720,
                color: featured ? 'inherit' : positive ? 'success.main' : 'error.main',
              }}
            >
              {positive ? '+' : ''}
              {change}%
            </Typography>
            <Typography
              sx={{ fontSize: '.64rem', color: featured ? 'rgba(7,27,25,.62)' : 'text.secondary' }}
            >
              {changeLabel}
            </Typography>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
