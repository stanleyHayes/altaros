import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardMedia from "@mui/material/CardMedia";
import Typography from "@mui/material/Typography";
import LinearProgress from "@mui/material/LinearProgress";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";

interface CampaignCardProps {
  title: string;
  description: string;
  targetAmount: number;
  raisedAmount: number;
  endDate: string;
  imageUrl?: string;
  onDonate: () => void;
}

export default function CampaignCard({
  title,
  description,
  targetAmount,
  raisedAmount,
  endDate,
  imageUrl,
  onDonate,
}: CampaignCardProps) {
  const progress = Math.min((raisedAmount / targetAmount) * 100, 100);

  return (
    <Card>
      {imageUrl && (
        <CardMedia
          component="img"
          height={140}
          image={imageUrl}
          alt={title}
        />
      )}
      <CardContent sx={{ p: 2.5 }}>
        <Typography variant="subtitle1" fontWeight={700} gutterBottom>
          {title}
        </Typography>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{
            mb: 2,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {description}
        </Typography>
        <Box sx={{ mb: 1.5 }}>
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              mb: 0.5,
            }}
          >
            <Typography variant="caption" fontWeight={600} color="primary.main">
              ${raisedAmount.toLocaleString()} raised
            </Typography>
            <Typography variant="caption" color="text.secondary">
              of ${targetAmount.toLocaleString()}
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={progress}
            sx={{
              height: 8,
              borderRadius: 4,
              bgcolor: "#EDE7F6",
              "& .MuiLinearProgress-bar": {
                borderRadius: 4,
                background:
                  "linear-gradient(90deg, #6B4C9A 0%, #9B7FCB 100%)",
              },
            }}
          />
        </Box>
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Typography variant="caption" color="text.secondary">
            Ends {endDate}
          </Typography>
          <Button
            variant="contained"
            size="small"
            onClick={onDonate}
          >
            Donate
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}
