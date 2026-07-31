import { useState, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  TableSortLabel,
  Paper,
  TextField,
  InputAdornment,
  Box,
  Typography,
} from "@mui/material";
import { Search as SearchIcon } from "@mui/icons-material";

export interface Column<T> {
  id: string;
  label: string;
  minWidth?: number;
  align?: "left" | "center" | "right";
  sortable?: boolean;
  render?: (row: T) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  title?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  rowsPerPageOptions?: number[];
  defaultRowsPerPage?: number;
  getRowId?: (row: T) => string;
  onRowClick?: (row: T) => void;
  toolbar?: React.ReactNode;
}

type SortOrder = "asc" | "desc";

export default function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  title,
  searchable = true,
  searchPlaceholder = "Search...",
  rowsPerPageOptions = [10, 25, 50],
  defaultRowsPerPage = 10,
  getRowId,
  onRowClick,
  toolbar,
}: DataTableProps<T>) {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(defaultRowsPerPage);
  const [searchQuery, setSearchQuery] = useState("");
  const [orderBy, setOrderBy] = useState<string>("");
  const [order, setOrder] = useState<SortOrder>("asc");

  const handleSort = (columnId: string) => {
    const isAsc = orderBy === columnId && order === "asc";
    setOrder(isAsc ? "desc" : "asc");
    setOrderBy(columnId);
  };

  const filteredRows = useMemo(() => {
    if (!searchQuery) return rows;
    const query = searchQuery.toLowerCase();
    return rows.filter((row) =>
      Object.values(row).some((val) =>
        String(val).toLowerCase().includes(query),
      ),
    );
  }, [rows, searchQuery]);

  const sortedRows = useMemo(() => {
    if (!orderBy) return filteredRows;
    return [...filteredRows].sort((a, b) => {
      const aVal = a[orderBy];
      const bVal = b[orderBy];
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      const cmp = String(aVal).localeCompare(String(bVal), undefined, {
        numeric: true,
      });
      return order === "asc" ? cmp : -cmp;
    });
  }, [filteredRows, orderBy, order]);

  const paginatedRows = sortedRows.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage,
  );

  return (
    <Paper sx={{ width: "100%", overflow: "hidden" }}>
      <Box
        sx={{
          p: 2,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 2,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          {title && (
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              {title}
            </Typography>
          )}
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          {searchable && (
            <TextField
              size="small"
              placeholder={searchPlaceholder}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(0);
              }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                },
              }}
              sx={{ minWidth: 240 }}
            />
          )}
          {toolbar}
        </Box>
      </Box>

      <TableContainer>
        <Table stickyHeader>
          <TableHead>
            <TableRow>
              {columns.map((column) => (
                <TableCell
                  key={column.id}
                  align={column.align || "left"}
                  sx={{ minWidth: column.minWidth }}
                >
                  {column.sortable !== false ? (
                    <TableSortLabel
                      active={orderBy === column.id}
                      direction={orderBy === column.id ? order : "asc"}
                      onClick={() => handleSort(column.id)}
                    >
                      {column.label}
                    </TableSortLabel>
                  ) : (
                    column.label
                  )}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} align="center" sx={{ py: 6 }}>
                  <Typography color="text.secondary">No data found</Typography>
                </TableCell>
              </TableRow>
            ) : (
              paginatedRows.map((row, index) => (
                <TableRow
                  hover
                  key={getRowId ? getRowId(row) : index}
                  onClick={() => onRowClick?.(row)}
                  sx={{
                    cursor: onRowClick ? "pointer" : "default",
                    "&:last-child td, &:last-child th": { border: 0 },
                  }}
                >
                  {columns.map((column) => (
                    <TableCell key={column.id} align={column.align || "left"}>
                      {column.render
                        ? column.render(row)
                        : (row[column.id] as React.ReactNode)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <TablePagination
        rowsPerPageOptions={rowsPerPageOptions}
        component="div"
        count={filteredRows.length}
        rowsPerPage={rowsPerPage}
        page={page}
        onPageChange={(_, newPage) => setPage(newPage)}
        onRowsPerPageChange={(e) => {
          setRowsPerPage(parseInt(e.target.value, 10));
          setPage(0);
        }}
      />
    </Paper>
  );
}
