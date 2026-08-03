import type { ReactNode } from "react";
import { Box, Typography } from "@mui/material";

export default function PageIntro({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy: string; action?: ReactNode }) {
  return <Box component="header" sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, justifyContent: "space-between", alignItems: { md: "end" }, gap: 2.5, mb: 3.5 }}><Box><Typography variant="overline" color="primary.main">{eyebrow}</Typography><Typography variant="h3" sx={{ mt: 1 }}>{title}</Typography><Typography color="text.secondary" sx={{ mt: 1, maxWidth: 650 }}>{copy}</Typography></Box>{action}</Box>;
}
