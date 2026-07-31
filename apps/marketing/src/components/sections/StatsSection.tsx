import { useEffect, useRef, useState } from "react";
import { Box, Container, Typography } from "@mui/material";

const stats = [
  { target: 1000, suffix: "+", label: "Churches" },
  { target: 500, suffix: "K+", label: "Members" },
  { target: 50, suffix: "+", label: "Denominations" },
  { target: 12, suffix: "", label: "Countries" },
];

function useCountUp(target: number, duration = 2000, start = false) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!start) return;

    let startTime: number | null = null;
    let frameId: number;

    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * target));

      if (progress < 1) {
        frameId = requestAnimationFrame(step);
      }
    };

    frameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameId);
  }, [target, duration, start]);

  return count;
}

function StatItem({
  target,
  suffix,
  label,
  inView,
}: {
  target: number;
  suffix: string;
  label: string;
  inView: boolean;
}) {
  const count = useCountUp(target, 2000, inView);

  return (
    <Box sx={{ textAlign: "center", flex: "1 1 200px" }}>
      <Typography
        variant="h2"
        sx={{
          fontWeight: 800,
          color: "primary.main",
          fontSize: { xs: "2.25rem", md: "3rem" },
          mb: 0.5,
        }}
      >
        {count.toLocaleString()}
        {suffix}
      </Typography>
      <Typography
        variant="body1"
        sx={{
          color: "text.secondary",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontSize: "0.9rem",
        }}
      >
        {label}
      </Typography>
    </Box>
  );
}

export default function StatsSection() {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <Box
      ref={ref}
      sx={{
        py: { xs: 8, md: 10 },
        backgroundColor: "#F8F9FF",
      }}
    >
      <Container maxWidth="lg">
        <Box
          sx={{
            display: "flex",
            flexWrap: "wrap",
            gap: { xs: 4, md: 6 },
            justifyContent: "center",
          }}
        >
          {stats.map((stat) => (
            <StatItem
              key={stat.label}
              target={stat.target}
              suffix={stat.suffix}
              label={stat.label}
              inView={inView}
            />
          ))}
        </Box>
      </Container>
    </Box>
  );
}
