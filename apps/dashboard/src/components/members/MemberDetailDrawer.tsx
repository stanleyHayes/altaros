import { useEffect, useState } from "react";
import {
  Drawer,
  Box,
  CircularProgress,
  Alert,
  Typography,
  Avatar,
  Chip,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from "@mui/material";
import {
  Close as CloseIcon,
  Email as EmailIcon,
  Phone as PhoneIcon,
  Home as HomeIcon,
  Cake as CakeIcon,
} from "@mui/icons-material";
import FinanceService, { type Transaction } from "@/services/finance.service";

interface MemberDetail {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  address?: string;
  dateOfBirth?: string;
  memberSince: string;
  status: string;
  groups?: string[];
  [key: string]: unknown;
}

interface MemberDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  member: MemberDetail | null;
}

/**
 * Money is shown in the currency the transaction was recorded in.
 *
 * The placeholder this replaced was hardcoded to US dollars in a platform
 * that runs on Ghana cedis, so the numbers were not merely invented — they
 * were invented in the wrong currency, on a screen a church would read as its
 * own record of what somebody gave.
 */
function money(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: currency || "GHS",
  }).format(minor / 100);
}

export default function MemberDetailDrawer({
  open,
  onClose,
  member,
}: MemberDetailDrawerProps) {
  const [giving, setGiving] = useState<Transaction[]>([]);
  const [givingState, setGivingState] = useState<
    "loading" | "ready" | "forbidden" | "error"
  >("loading");

  const memberId = member?.id;
  useEffect(() => {
    if (!open || !memberId) return;
    let cancelled = false;
    setGivingState("loading");
    (async () => {
      try {
        const txs = await FinanceService.getMemberGiving(memberId);
        if (!cancelled) {
          setGiving(txs);
          setGivingState("ready");
        }
      } catch (err) {
        if (cancelled) return;
        // Reading a member's giving needs finance:read. Someone without it
        // is not seeing an outage, so it must not be reported as one.
        const status = (err as { response?: { status?: number } })?.response?.status;
        setGivingState(status === 403 ? "forbidden" : "error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, memberId]);

  if (!member) return null;

  const fullName = `${member.firstName} ${member.lastName}`;
  const initials = `${member.firstName[0]}${member.lastName[0]}`;

  const contactItems = [
    { icon: <EmailIcon fontSize="small" />, label: "Email", value: member.email },
    { icon: <PhoneIcon fontSize="small" />, label: "Phone", value: member.phone },
    { icon: <HomeIcon fontSize="small" />, label: "Address", value: member.address },
    {
      icon: <CakeIcon fontSize="small" />,
      label: "Date of Birth",
      value: member.dateOfBirth,
    },
  ].filter((item) => item.value);

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{ paper: { sx: { width: { xs: "100%", sm: 420 } } } }}
    >
      <Box sx={{ p: 3 }}>
        {/* Header */}
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            mb: 3,
          }}
        >
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            Member Details
          </Typography>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>

        {/* Profile */}
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            mb: 3,
          }}
        >
          <Avatar
            sx={{
              width: 72,
              height: 72,
              fontSize: 28,
              bgcolor: "primary.main",
              mb: 1.5,
            }}
          >
            {initials}
          </Avatar>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            {fullName}
          </Typography>
          <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
            <Chip
              label={member.status}
              size="small"
              color={
                member.status === "active"
                  ? "success"
                  : member.status === "inactive"
                    ? "default"
                    : "info"
              }
            />
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Member since {member.memberSince}
          </Typography>
        </Box>

        <Divider sx={{ mb: 2 }} />

        {/* Contact Information */}
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
          Contact Information
        </Typography>
        <List dense disablePadding>
          {contactItems.map((item) => (
            <ListItem key={item.label} sx={{ px: 0 }}>
              <Box sx={{ mr: 1.5, color: "text.secondary" }}>{item.icon}</Box>
              <ListItemText
                primary={
                  <Typography variant="body2" color="text.secondary">
                    {item.label}
                  </Typography>
                }
                secondary={
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {item.value}
                  </Typography>
                }
              />
            </ListItem>
          ))}
          {contactItems.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
              No contact information available
            </Typography>
          )}
        </List>

        <Divider sx={{ my: 2 }} />

        {/* Departments / Groups */}
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
          Departments
        </Typography>
        {member.groups && member.groups.length > 0 ? (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 2 }}>
            {member.groups.map((group) => (
              <Chip key={group} label={group} size="small" variant="outlined" />
            ))}
          </Box>
        ) : (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mb: 2 }}
          >
            Not assigned to any departments
          </Typography>
        )}

        <Divider sx={{ my: 2 }} />

        {/* Giving History Summary */}
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.5 }}>
          Recent Giving
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600, py: 0.5 }}>Date</TableCell>
              <TableCell sx={{ fontWeight: 600, py: 0.5 }}>Type</TableCell>
              <TableCell sx={{ fontWeight: 600, py: 0.5 }} align="right">
                Amount
              </TableCell>
            </TableRow>
          </TableHead>
          {givingState === "loading" && (
            <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
              <CircularProgress size={22} />
            </Box>
          )}
          {givingState === "forbidden" && (
            <Alert severity="info" sx={{ mb: 1 }}>
              Giving records are not available to your role.
            </Alert>
          )}
          {givingState === "error" && (
            <Alert severity="warning" sx={{ mb: 1 }}>
              We could not load this member’s giving.
            </Alert>
          )}
          <TableBody>
            {givingState === "ready" && giving.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} sx={{ py: 2, border: 0 }}>
                  <Typography variant="body2" color="text.secondary">
                    No giving recorded yet.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {giving.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell sx={{ py: 0.5 }}>
                  <Typography variant="body2">
                    {(entry.date ?? entry.createdAt ?? "").slice(0, 10)}
                  </Typography>
                </TableCell>
                <TableCell sx={{ py: 0.5 }}>
                  <Typography variant="body2" sx={{ textTransform: "capitalize" }}>
                    {entry.type}
                  </Typography>
                </TableCell>
                <TableCell sx={{ py: 0.5 }} align="right">
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {money(entry.amount, entry.currency)}
                  </Typography>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Drawer>
  );
}
