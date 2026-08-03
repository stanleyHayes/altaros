import type { ReactNode } from "react";
import { Box, Typography } from "@mui/material";

export default function PageIntro({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy: string; action?: ReactNode }) {
  return <Box component="header" sx={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 2, mb: 3 }}><Box><Typography variant="overline" color="primary.main">{eyebrow}</Typography><Typography variant="h3" sx={{ mt: .8 }}>{title}</Typography><Typography color="text.secondary" sx={{ mt: .8, maxWidth: 600 }}>{copy}</Typography></Box>{action}</Box>;
}
