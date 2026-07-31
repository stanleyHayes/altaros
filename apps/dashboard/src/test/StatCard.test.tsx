import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { theme } from '@/theme';
import StatCard from '@/components/ui/StatCard';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';

describe('StatCard', () => {
  it('renders title and value', () => {
    render(
      <ThemeProvider theme={theme}>
        <StatCard
          title="Total Members"
          value="1,234"
          change={12.5}
          icon={<TrendingUpIcon />}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText('Total Members')).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument();
  });
});
