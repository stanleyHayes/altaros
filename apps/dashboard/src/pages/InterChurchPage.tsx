import { useState } from "react";
import {
  Box,
  Typography,
  Tabs,
  Tab,
  TextField,
  InputAdornment,
  Grid,
  Card,
  CardContent,
  CardActions,
  Button,
  Chip,
  Avatar,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Rating,
  Badge,
  IconButton,
  type SelectChangeEvent,
} from "@mui/material";
import {
  Search as SearchIcon,
  Verified as VerifiedIcon,
  Add as AddIcon,
  Public as PublicIcon,
  LocationOn as LocationIcon,
  People as PeopleIcon,
  AccessTime as TimeIcon,
  Send as SendIcon,
  ArrowForward as ArrowForwardIcon,
  Store as StoreIcon,
} from "@mui/icons-material";
import type {
  ChurchListing,
  MarketplaceItem,
  CollaborationRequest,
} from "@altar-os/shared-types";

// ---------- Mock Data ----------

const mockChurches: ChurchListing[] = [
  {
    id: "c1",
    churchId: "ch-001",
    churchName: "Grace Community Church",
    city: "Accra",
    country: "Ghana",
    denomination: "Non-Denominational",
    memberCount: 1200,
    description:
      "A vibrant, spirit-filled community of believers committed to worship and outreach.",
    services: [
      { day: "Sunday", time: "8:00 AM", name: "First Service" },
      { day: "Sunday", time: "10:30 AM", name: "Second Service" },
      { day: "Wednesday", time: "6:30 PM", name: "Mid-Week Service" },
    ],
    isVerified: true,
    rating: 4.8,
    reviewCount: 156,
  },
  {
    id: "c2",
    churchId: "ch-002",
    churchName: "Redeemer Baptist Church",
    city: "Lagos",
    country: "Nigeria",
    denomination: "Baptist",
    memberCount: 850,
    description:
      "Rooted in scripture, reaching the nations. A Baptist church with a heart for missions.",
    services: [
      { day: "Sunday", time: "9:00 AM", name: "Worship Service" },
      { day: "Friday", time: "7:00 PM", name: "Prayer Meeting" },
    ],
    isVerified: true,
    rating: 4.5,
    reviewCount: 98,
  },
  {
    id: "c3",
    churchId: "ch-003",
    churchName: "Hillside Presbyterian Church",
    city: "Nairobi",
    country: "Kenya",
    denomination: "Presbyterian",
    memberCount: 620,
    description:
      "A Reformed church community serving families and building disciples in East Africa.",
    services: [
      { day: "Sunday", time: "10:00 AM", name: "Morning Worship" },
      { day: "Thursday", time: "6:00 PM", name: "Bible Study" },
    ],
    isVerified: false,
    rating: 4.2,
    reviewCount: 47,
  },
  {
    id: "c4",
    churchId: "ch-004",
    churchName: "Living Waters Assembly",
    city: "Accra",
    country: "Ghana",
    denomination: "Pentecostal",
    memberCount: 2100,
    description:
      "An energetic Pentecostal assembly with a focus on youth ministry and community impact.",
    services: [
      { day: "Sunday", time: "7:30 AM", name: "Dawn Service" },
      { day: "Sunday", time: "10:00 AM", name: "Main Service" },
      { day: "Tuesday", time: "6:30 PM", name: "Miracle Night" },
    ],
    isVerified: true,
    rating: 4.6,
    reviewCount: 210,
  },
  {
    id: "c5",
    churchId: "ch-005",
    churchName: "Christ the King Catholic Parish",
    city: "Kumasi",
    country: "Ghana",
    denomination: "Catholic",
    memberCount: 3200,
    description:
      "A historic Catholic parish with a rich liturgical tradition and active social ministries.",
    services: [
      { day: "Sunday", time: "6:30 AM", name: "First Mass" },
      { day: "Sunday", time: "9:00 AM", name: "Family Mass" },
      { day: "Daily", time: "6:00 AM", name: "Weekday Mass" },
    ],
    isVerified: true,
    rating: 4.7,
    reviewCount: 320,
  },
  {
    id: "c6",
    churchId: "ch-006",
    churchName: "Covenant Life Chapel",
    city: "Johannesburg",
    country: "South Africa",
    denomination: "Charismatic",
    memberCount: 480,
    description:
      "A growing charismatic congregation passionate about worship and discipleship.",
    services: [
      { day: "Sunday", time: "9:30 AM", name: "Sunday Celebration" },
    ],
    isVerified: false,
    rating: 4.0,
    reviewCount: 22,
  },
];

const mockMarketplaceItems: MarketplaceItem[] = [
  {
    id: "m1",
    churchId: "ch-001",
    churchName: "Grace Community Church",
    title: "Leadership Training Manual",
    description:
      "Comprehensive 12-week leadership development curriculum for church leaders.",
    category: "training",
    price: 49.99,
    currency: "USD",
    isActive: true,
    createdAt: "2026-03-15T10:00:00Z",
  },
  {
    id: "m2",
    churchId: "ch-002",
    churchName: "Redeemer Baptist Church",
    title: "Sunday School Curriculum Pack",
    description:
      "Full-year children's Sunday school materials with activities and lesson plans.",
    category: "resource",
    price: 29.99,
    currency: "USD",
    isActive: true,
    createdAt: "2026-03-10T08:00:00Z",
  },
  {
    id: "m3",
    churchId: "ch-004",
    churchName: "Living Waters Assembly",
    title: "Worship Team Mentoring",
    description:
      "4-session virtual mentoring program for worship team development.",
    category: "service",
    price: 120.0,
    currency: "USD",
    isActive: true,
    createdAt: "2026-03-01T12:00:00Z",
  },
  {
    id: "m4",
    churchId: "ch-001",
    churchName: "Grace Community Church",
    title: "Easter Production Pack",
    description:
      "Full media pack including motion backgrounds, bumper videos, and slide templates for Easter.",
    category: "media",
    price: 35.0,
    currency: "USD",
    isActive: true,
    createdAt: "2026-02-20T14:00:00Z",
  },
  {
    id: "m5",
    churchId: "ch-005",
    churchName: "Christ the King Catholic Parish",
    title: "Sound System Rental",
    description:
      "Professional PA system available for church events and conferences. Includes setup.",
    category: "equipment",
    price: 250.0,
    currency: "USD",
    isActive: true,
    createdAt: "2026-02-15T09:00:00Z",
  },
  {
    id: "m6",
    churchId: "ch-003",
    churchName: "Hillside Presbyterian Church",
    title: "Marriage Enrichment Course",
    description:
      "8-week couples course materials with facilitator guide and participant workbooks.",
    category: "training",
    price: 59.99,
    currency: "USD",
    isActive: true,
    createdAt: "2026-01-28T11:00:00Z",
  },
];

const mockCollaborations: CollaborationRequest[] = [
  {
    id: "col-1",
    fromChurchId: "ch-001",
    fromChurchName: "Grace Community Church",
    toChurchId: "ch-002",
    toChurchName: "Redeemer Baptist Church",
    type: "event_collab",
    title: "Joint Easter Crusade",
    description:
      "We would love to partner for a city-wide Easter crusade event. We can provide the venue and worship team.",
    status: "pending",
    createdAt: "2026-03-20T09:00:00Z",
  },
  {
    id: "col-2",
    fromChurchId: "ch-004",
    fromChurchName: "Living Waters Assembly",
    toChurchId: "ch-001",
    toChurchName: "Grace Community Church",
    type: "pulpit_exchange",
    title: "Pulpit Exchange Program",
    description:
      "Proposing a quarterly pulpit exchange to foster unity between our congregations.",
    status: "accepted",
    createdAt: "2026-03-10T14:00:00Z",
  },
  {
    id: "col-3",
    fromChurchId: "ch-001",
    fromChurchName: "Grace Community Church",
    toChurchId: "ch-003",
    toChurchName: "Hillside Presbyterian Church",
    type: "resource_share",
    title: "Youth Ministry Resources",
    description:
      "We'd like to share our youth ministry training materials and potentially co-host a youth camp.",
    status: "pending",
    createdAt: "2026-03-05T16:00:00Z",
  },
  {
    id: "col-4",
    fromChurchId: "ch-005",
    fromChurchName: "Christ the King Catholic Parish",
    toChurchId: "ch-001",
    toChurchName: "Grace Community Church",
    type: "joint_outreach",
    title: "Community Food Drive",
    description:
      "Invitation to partner on a monthly community food distribution program for underserved areas.",
    status: "declined",
    createdAt: "2026-02-28T10:00:00Z",
  },
];

// ---------- Helpers ----------

const CATEGORY_COLORS: Record<MarketplaceItem["category"], string> = {
  resource: "#2196F3",
  service: "#4CAF50",
  training: "#FF9800",
  media: "#9C27B0",
  equipment: "#607D8B",
};

const COLLAB_TYPE_LABELS: Record<CollaborationRequest["type"], string> = {
  event_collab: "Event Collaboration",
  resource_share: "Resource Sharing",
  pulpit_exchange: "Pulpit Exchange",
  joint_outreach: "Joint Outreach",
};

const STATUS_COLORS: Record<
  CollaborationRequest["status"],
  "warning" | "success" | "error"
> = {
  pending: "warning",
  accepted: "success",
  declined: "error",
};

// ---------- Component ----------

export default function InterChurchPage() {
  const [tabIndex, setTabIndex] = useState(0);

  // Discover state
  const [searchQuery, setSearchQuery] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [denomFilter, setDenomFilter] = useState("");

  // Marketplace state
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [listingDialogOpen, setListingDialogOpen] = useState(false);

  // Collaboration state
  const [collabDialogOpen, setCollabDialogOpen] = useState(false);

  // ---------- Discover Tab ----------

  const filteredChurches = mockChurches.filter((c) => {
    if (
      searchQuery &&
      !c.churchName.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !c.city.toLowerCase().includes(searchQuery.toLowerCase())
    )
      return false;
    if (cityFilter && c.city !== cityFilter) return false;
    if (denomFilter && c.denomination !== denomFilter) return false;
    return true;
  });

  const uniqueCities = [...new Set(mockChurches.map((c) => c.city))];
  const uniqueDenominations = [
    ...new Set(mockChurches.map((c) => c.denomination)),
  ];

  // ---------- Marketplace Tab ----------

  const filteredItems = mockMarketplaceItems.filter(
    (item) => categoryFilter === "all" || item.category === categoryFilter,
  );

  // ---------- Render ----------

  return (
    <Box>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 3,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <PublicIcon sx={{ fontSize: 32, color: "primary.main" }} />
          <Typography variant="h4" fontWeight={700}>
            Inter-Church
          </Typography>
        </Box>
      </Box>

      <Tabs
        value={tabIndex}
        onChange={(_, v) => setTabIndex(v)}
        sx={{ mb: 3 }}
      >
        <Tab label="Discover" />
        <Tab label="Marketplace" />
        <Tab label="Collaboration" />
      </Tabs>

      {/* ===== DISCOVER TAB ===== */}
      {tabIndex === 0 && (
        <Box>
          {/* Filters */}
          <Box
            sx={{
              display: "flex",
              gap: 2,
              mb: 3,
              flexWrap: "wrap",
            }}
          >
            <TextField
              placeholder="Search churches..."
              size="small"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon />
                    </InputAdornment>
                  ),
                },
              }}
              sx={{ minWidth: 260 }}
            />
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>City</InputLabel>
              <Select
                value={cityFilter}
                label="City"
                onChange={(e: SelectChangeEvent) =>
                  setCityFilter(e.target.value)
                }
              >
                <MenuItem value="">All Cities</MenuItem>
                {uniqueCities.map((city) => (
                  <MenuItem key={city} value={city}>
                    {city}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel>Denomination</InputLabel>
              <Select
                value={denomFilter}
                label="Denomination"
                onChange={(e: SelectChangeEvent) =>
                  setDenomFilter(e.target.value)
                }
              >
                <MenuItem value="">All Denominations</MenuItem>
                {uniqueDenominations.map((d) => (
                  <MenuItem key={d} value={d}>
                    {d}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          {/* Church Grid */}
          <Grid container spacing={3}>
            {filteredChurches.map((church) => (
              <Grid key={church.id} size={{ xs: 12, sm: 6, md: 4 }}>
                <Card
                  sx={{
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <CardContent sx={{ flex: 1 }}>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1.5,
                        mb: 2,
                      }}
                    >
                      <Avatar
                        sx={{
                          width: 48,
                          height: 48,
                          bgcolor: "primary.main",
                          fontSize: 20,
                        }}
                      >
                        {church.churchName.charAt(0)}
                      </Avatar>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 0.5,
                          }}
                        >
                          <Typography
                            variant="subtitle1"
                            fontWeight={600}
                            noWrap
                          >
                            {church.churchName}
                          </Typography>
                          {church.isVerified && (
                            <VerifiedIcon
                              sx={{ fontSize: 18, color: "primary.main" }}
                            />
                          )}
                        </Box>
                        <Chip
                          label={church.denomination}
                          size="small"
                          variant="outlined"
                          sx={{ mt: 0.25 }}
                        />
                      </Box>
                    </Box>

                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{
                        mb: 1.5,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {church.description}
                    </Typography>

                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 0.5,
                        mb: 0.5,
                      }}
                    >
                      <LocationIcon
                        sx={{ fontSize: 16, color: "text.secondary" }}
                      />
                      <Typography variant="caption" color="text.secondary">
                        {church.city}, {church.country}
                      </Typography>
                    </Box>

                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 0.5,
                        mb: 0.5,
                      }}
                    >
                      <PeopleIcon
                        sx={{ fontSize: 16, color: "text.secondary" }}
                      />
                      <Typography variant="caption" color="text.secondary">
                        {church.memberCount.toLocaleString()} members
                      </Typography>
                    </Box>

                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 0.5,
                        mb: 1.5,
                      }}
                    >
                      <Rating
                        value={church.rating}
                        precision={0.1}
                        size="small"
                        readOnly
                      />
                      <Typography variant="caption" color="text.secondary">
                        ({church.reviewCount})
                      </Typography>
                    </Box>

                    {/* Service Times */}
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                      {church.services.map((s, i) => (
                        <Chip
                          key={i}
                          icon={<TimeIcon sx={{ fontSize: "14px !important" }} />}
                          label={`${s.day} ${s.time}`}
                          size="small"
                          variant="outlined"
                          sx={{ fontSize: "0.75rem" }}
                        />
                      ))}
                    </Box>
                  </CardContent>
                  <CardActions sx={{ px: 2, pb: 2 }}>
                    <Button
                      variant="contained"
                      size="small"
                      startIcon={<SendIcon />}
                      fullWidth
                    >
                      Connect
                    </Button>
                  </CardActions>
                </Card>
              </Grid>
            ))}
            {filteredChurches.length === 0 && (
              <Grid size={12}>
                <Box sx={{ textAlign: "center", py: 6 }}>
                  <Typography color="text.secondary">
                    No churches found matching your criteria.
                  </Typography>
                </Box>
              </Grid>
            )}
          </Grid>
        </Box>
      )}

      {/* ===== MARKETPLACE TAB ===== */}
      {tabIndex === 1 && (
        <Box>
          {/* Toolbar */}
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              mb: 3,
              flexWrap: "wrap",
              gap: 2,
            }}
          >
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel>Category</InputLabel>
              <Select
                value={categoryFilter}
                label="Category"
                onChange={(e: SelectChangeEvent) =>
                  setCategoryFilter(e.target.value)
                }
              >
                <MenuItem value="all">All Categories</MenuItem>
                <MenuItem value="resource">Resources</MenuItem>
                <MenuItem value="service">Services</MenuItem>
                <MenuItem value="training">Training</MenuItem>
                <MenuItem value="media">Media</MenuItem>
                <MenuItem value="equipment">Equipment</MenuItem>
              </Select>
            </FormControl>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setListingDialogOpen(true)}
            >
              List Item
            </Button>
          </Box>

          {/* Items Grid */}
          <Grid container spacing={3}>
            {filteredItems.map((item) => (
              <Grid key={item.id} size={{ xs: 12, sm: 6, md: 4 }}>
                <Card
                  sx={{
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  {/* Image placeholder */}
                  <Box
                    sx={{
                      height: 140,
                      bgcolor: "grey.100",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <StoreIcon sx={{ fontSize: 48, color: "grey.400" }} />
                  </Box>
                  <CardContent sx={{ flex: 1 }}>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        mb: 1,
                      }}
                    >
                      <Chip
                        label={item.category}
                        size="small"
                        sx={{
                          bgcolor: CATEGORY_COLORS[item.category],
                          color: "white",
                          fontWeight: 600,
                          textTransform: "capitalize",
                        }}
                      />
                      <Typography variant="h6" fontWeight={700} color="primary">
                        ${item.price.toFixed(2)}
                      </Typography>
                    </Box>
                    <Typography variant="subtitle1" fontWeight={600} noWrap>
                      {item.title}
                    </Typography>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{
                        mb: 1,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {item.description}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      by {item.churchName}
                    </Typography>
                  </CardContent>
                  <CardActions sx={{ px: 2, pb: 2 }}>
                    <Button
                      variant="outlined"
                      size="small"
                      endIcon={<ArrowForwardIcon />}
                      fullWidth
                    >
                      View Details
                    </Button>
                  </CardActions>
                </Card>
              </Grid>
            ))}
            {filteredItems.length === 0 && (
              <Grid size={12}>
                <Box sx={{ textAlign: "center", py: 6 }}>
                  <Typography color="text.secondary">
                    No items found in this category.
                  </Typography>
                </Box>
              </Grid>
            )}
          </Grid>

          {/* List Item Dialog */}
          <ListingDialog
            open={listingDialogOpen}
            onClose={() => setListingDialogOpen(false)}
          />
        </Box>
      )}

      {/* ===== COLLABORATION TAB ===== */}
      {tabIndex === 2 && (
        <Box>
          <Box
            sx={{
              display: "flex",
              justifyContent: "flex-end",
              mb: 3,
            }}
          >
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setCollabDialogOpen(true)}
            >
              New Request
            </Button>
          </Box>

          {/* Incoming Requests */}
          <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
            Incoming Requests
          </Typography>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mb: 4 }}>
            {mockCollaborations
              .filter((c) => c.toChurchId === "ch-001")
              .map((collab) => (
                <CollaborationCard key={collab.id} collab={collab} />
              ))}
          </Box>

          {/* Outgoing Requests */}
          <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
            Outgoing Requests
          </Typography>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mb: 4 }}>
            {mockCollaborations
              .filter((c) => c.fromChurchId === "ch-001")
              .map((collab) => (
                <CollaborationCard key={collab.id} collab={collab} />
              ))}
          </Box>

          {/* New Request Dialog */}
          <CollaborationDialog
            open={collabDialogOpen}
            onClose={() => setCollabDialogOpen(false)}
            churches={mockChurches}
          />
        </Box>
      )}
    </Box>
  );
}

// ---------- Sub-components ----------

function CollaborationCard({ collab }: { collab: CollaborationRequest }) {
  return (
    <Card>
      <CardContent>
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            mb: 1,
          }}
        >
          <Box>
            <Typography variant="subtitle1" fontWeight={600}>
              {collab.title}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {collab.fromChurchName} &rarr; {collab.toChurchName}
            </Typography>
          </Box>
          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            <Chip
              label={COLLAB_TYPE_LABELS[collab.type]}
              size="small"
              variant="outlined"
            />
            <Chip
              label={collab.status}
              size="small"
              color={STATUS_COLORS[collab.status]}
              sx={{ textTransform: "capitalize" }}
            />
          </Box>
        </Box>
        <Typography variant="body2" color="text.secondary">
          {collab.description}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
          {new Date(collab.createdAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </Typography>
      </CardContent>
    </Card>
  );
}

function ListingDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<MarketplaceItem["category"]>("resource");
  const [price, setPrice] = useState("");

  const handleSubmit = () => {
    // TODO: call MarketplaceService.createListing
    onClose();
    setTitle("");
    setDescription("");
    setCategory("resource");
    setPrice("");
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>List a New Item</DialogTitle>
      <DialogContent>
        <Box
          sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}
        >
          <TextField
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            fullWidth
            required
          />
          <TextField
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            multiline
            rows={3}
            required
          />
          <FormControl fullWidth>
            <InputLabel>Category</InputLabel>
            <Select
              value={category}
              label="Category"
              onChange={(e: SelectChangeEvent) =>
                setCategory(e.target.value as MarketplaceItem["category"])
              }
            >
              <MenuItem value="resource">Resource</MenuItem>
              <MenuItem value="service">Service</MenuItem>
              <MenuItem value="training">Training</MenuItem>
              <MenuItem value="media">Media</MenuItem>
              <MenuItem value="equipment">Equipment</MenuItem>
            </Select>
          </FormControl>
          <TextField
            label="Price (USD)"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            type="number"
            fullWidth
            required
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={!title || !description || !price}
        >
          Create Listing
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function CollaborationDialog({
  open,
  onClose,
  churches,
}: {
  open: boolean;
  onClose: () => void;
  churches: ChurchListing[];
}) {
  const [toChurchId, setToChurchId] = useState("");
  const [type, setType] = useState<CollaborationRequest["type"]>("event_collab");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const handleSubmit = () => {
    // TODO: call MarketplaceService.sendCollaborationRequest
    onClose();
    setToChurchId("");
    setType("event_collab");
    setTitle("");
    setDescription("");
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>New Collaboration Request</DialogTitle>
      <DialogContent>
        <Box
          sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}
        >
          <FormControl fullWidth required>
            <InputLabel>Church</InputLabel>
            <Select
              value={toChurchId}
              label="Church"
              onChange={(e: SelectChangeEvent) =>
                setToChurchId(e.target.value)
              }
            >
              {churches.map((c) => (
                <MenuItem key={c.churchId} value={c.churchId}>
                  {c.churchName}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl fullWidth required>
            <InputLabel>Type</InputLabel>
            <Select
              value={type}
              label="Type"
              onChange={(e: SelectChangeEvent) =>
                setType(e.target.value as CollaborationRequest["type"])
              }
            >
              <MenuItem value="event_collab">Event Collaboration</MenuItem>
              <MenuItem value="resource_share">Resource Sharing</MenuItem>
              <MenuItem value="pulpit_exchange">Pulpit Exchange</MenuItem>
              <MenuItem value="joint_outreach">Joint Outreach</MenuItem>
            </Select>
          </FormControl>
          <TextField
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            fullWidth
            required
          />
          <TextField
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            multiline
            rows={3}
            required
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={!toChurchId || !title || !description}
          startIcon={<SendIcon />}
        >
          Send Request
        </Button>
      </DialogActions>
    </Dialog>
  );
}
