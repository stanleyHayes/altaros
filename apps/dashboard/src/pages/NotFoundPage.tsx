import { Box, Typography, Button } from "@mui/material";
import { useNavigate } from "react-router-dom";

// -- Adinkra SVG paths (simplified but recognizable) --

function GyeNyame({ size = 48, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none" style={style}>
      <path
        d="M40 8c-4 0-8 6-8 14 0 6 2 10 4 14-8-2-18 0-22 6-3 5-1 12 4 16 4 3 8 4 12 4-4 6-6 14-2 20 3 5 10 6 16 4 4-2 7-5 9-8 2 8 6 14 12 14s10-6 12-14c2 3 5 6 9 8 6 2 13 1 16-4 4-6 2-14-2-20 4 0 8-1 12-4 5-4 7-11 4-16-4-6-14-8-22-6 2-4 4-8 4-14 0-8-4-14-8-14s-8 6-8 14c0 4 1 8 3 11-3-3-6-5-10-5s-7 2-10 5c2-3 3-7 3-11 0-8-4-14-8-14z"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="adinkra-path"
      />
    </svg>
  );
}

function Sankofa({ size = 40, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none" style={style}>
      <path
        d="M55 15c-8-2-16 2-20 8-4 6-4 14 0 20l-10 14c-2 3-1 6 2 8 3 2 6 1 8-2l10-14c8 4 18 2 24-4 6-8 4-18-4-24-4-3-8-5-10-6zm2 12a6 6 0 1 1 0 12 6 6 0 0 1 0-12z"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="adinkra-path"
      />
    </svg>
  );
}

function Dwennimmen({ size = 40, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none" style={style}>
      <path
        d="M40 10c-10 0-18 8-18 18 0 6 3 11 8 14v6h20v-6c5-3 8-8 8-14 0-10-8-18-18-18zM22 48c-6 4-10 10-10 18h56c0-8-4-14-10-18"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="adinkra-path"
      />
      <path
        d="M30 28c0-4 4-8 10-8M50 28c0-4-4-8-10-8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="adinkra-path"
      />
    </svg>
  );
}

// -- Confused church SVG doodle --
function ConfusedChurch() {
  return (
    <svg
      width="180"
      height="200"
      viewBox="0 0 180 200"
      fill="none"
      className="church-wobble"
    >
      {/* Church body */}
      <path
        d="M30 190 L30 100 L90 55 L150 100 L150 190 Z"
        stroke="#333"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="#FFF8E7"
        className="draw-line"
      />
      {/* Door */}
      <path
        d="M70 190 L70 145 Q90 135 110 145 L110 190"
        stroke="#333"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="#CE1126"
        opacity="0.3"
        className="draw-line"
      />
      {/* Windows */}
      <circle cx="55" cy="125" r="10" stroke="#333" strokeWidth="2" fill="#FFD700" opacity="0.4" className="draw-line" />
      <circle cx="125" cy="125" r="10" stroke="#333" strokeWidth="2" fill="#FFD700" opacity="0.4" className="draw-line" />
      {/* Cross on top - tilted for confused look */}
      <g transform="translate(90, 35) rotate(15)">
        <line x1="0" y1="-25" x2="0" y2="5" stroke="#333" strokeWidth="3" strokeLinecap="round" className="draw-line" />
        <line x1="-12" y1="-15" x2="12" y2="-15" stroke="#333" strokeWidth="3" strokeLinecap="round" className="draw-line" />
      </g>
      {/* Confused eyes on the church */}
      <g>
        <circle cx="65" cy="88" r="5" fill="#333" className="blink" />
        <circle cx="115" cy="88" r="5" fill="#333" className="blink" />
        {/* Confused eyebrows */}
        <path d="M58 80 L72 76" stroke="#333" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M108 76 L122 80" stroke="#333" strokeWidth="2.5" strokeLinecap="round" />
        {/* Wobbly mouth */}
        <path d="M75 100 Q82 96 90 100 Q98 104 105 100" stroke="#333" strokeWidth="2" strokeLinecap="round" fill="none" />
      </g>
      {/* Question marks floating around */}
      <text x="155" y="50" fontSize="22" fill="#CE1126" className="float-item" style={{ animationDelay: "0s" }}>?</text>
      <text x="15" y="65" fontSize="18" fill="#006B3F" className="float-item" style={{ animationDelay: "0.5s" }}>?</text>
      {/* Small doodle lines for hand-drawn feel */}
      <path d="M28 191 L152 191" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeDasharray="4 4" />
    </svg>
  );
}

export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <>
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          25% { transform: translateY(-18px) rotate(5deg); }
          50% { transform: translateY(-8px) rotate(-3deg); }
          75% { transform: translateY(-22px) rotate(4deg); }
        }
        @keyframes wobble {
          0%, 100% { transform: rotate(0deg); }
          25% { transform: rotate(-3deg); }
          50% { transform: rotate(2deg); }
          75% { transform: rotate(-2deg); }
        }
        @keyframes draw {
          from { stroke-dashoffset: 1000; }
          to { stroke-dashoffset: 0; }
        }
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes kenteShift {
          0% { background-position: 0% 0%; }
          100% { background-position: 200% 0%; }
        }
        @keyframes blink {
          0%, 90%, 100% { transform: scaleY(1); }
          95% { transform: scaleY(0.1); }
        }
        @keyframes squiggle {
          0% { d: path("M0 5 Q25 0 50 5 Q75 10 100 5"); }
          50% { d: path("M0 5 Q25 10 50 5 Q75 0 100 5"); }
          100% { d: path("M0 5 Q25 0 50 5 Q75 10 100 5"); }
        }
        @keyframes buttonWiggle {
          0%, 100% { transform: rotate(0deg); }
          25% { transform: rotate(-1.5deg); }
          75% { transform: rotate(1.5deg); }
        }
        @keyframes dotPattern {
          0% { background-position: 0 0; }
          100% { background-position: 20px 20px; }
        }
        .church-wobble {
          animation: wobble 3s ease-in-out infinite;
          transform-origin: bottom center;
        }
        .float-item {
          animation: float 4s ease-in-out infinite;
        }
        .draw-line {
          stroke-dasharray: 1000;
          stroke-dashoffset: 1000;
          animation: draw 2s ease forwards;
        }
        .blink {
          animation: blink 4s ease-in-out infinite;
          transform-origin: center;
        }
        .adinkra-path {
          stroke-dasharray: 500;
          stroke-dashoffset: 500;
          animation: draw 2.5s ease forwards;
        }
        .kente-text {
          background: repeating-linear-gradient(
            90deg,
            #FFD700 0px, #FFD700 12px,
            #006B3F 12px, #006B3F 24px,
            #CE1126 24px, #CE1126 36px,
            #000 36px, #000 48px,
            #FF8C00 48px, #FF8C00 60px
          );
          background-size: 200% 100%;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: kenteShift 4s linear infinite;
        }
        .sketchy-button {
          position: relative;
          border: 3px solid #333;
          border-radius: 12px 8px 14px 6px;
          transition: all 0.3s ease;
        }
        .sketchy-button:hover {
          animation: buttonWiggle 0.3s ease-in-out infinite;
          background-color: #FFD700 !important;
          border-color: #006B3F;
        }
        .dot-bg {
          background-image: radial-gradient(circle, #00000008 1.5px, transparent 1.5px);
          background-size: 20px 20px;
          animation: dotPattern 8s linear infinite;
        }
      `}</style>
      <Box
        className="dot-bg"
        sx={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: "#FFF8F0",
          position: "relative",
          overflow: "hidden",
          px: 3,
        }}
      >
        {/* Floating Adinkra Symbols */}
        <Box sx={{ position: "absolute", top: "8%", left: "8%", color: "#FFD700", opacity: 0.6 }} className="float-item" style={{ animationDelay: "0s", animationDuration: "5s" }}>
          <GyeNyame size={56} />
        </Box>
        <Box sx={{ position: "absolute", top: "15%", right: "10%", color: "#006B3F", opacity: 0.5 }} className="float-item" style={{ animationDelay: "1.2s", animationDuration: "6s" }}>
          <Sankofa size={44} />
        </Box>
        <Box sx={{ position: "absolute", bottom: "18%", left: "12%", color: "#CE1126", opacity: 0.5 }} className="float-item" style={{ animationDelay: "0.7s", animationDuration: "5.5s" }}>
          <Dwennimmen size={44} />
        </Box>
        <Box sx={{ position: "absolute", bottom: "12%", right: "8%", color: "#FF8C00", opacity: 0.5 }} className="float-item" style={{ animationDelay: "2s", animationDuration: "7s" }}>
          <GyeNyame size={38} />
        </Box>
        <Box sx={{ position: "absolute", top: "50%", left: "4%", color: "#006B3F", opacity: 0.35 }} className="float-item" style={{ animationDelay: "1.5s", animationDuration: "6.5s" }}>
          <Sankofa size={32} />
        </Box>

        {/* Main content */}
        <Box
          sx={{
            textAlign: "center",
            animation: "fadeInUp 0.8s ease forwards",
            zIndex: 1,
          }}
        >
          {/* 404 Text with Kente Pattern */}
          <Typography
            className="kente-text"
            sx={{
              fontSize: { xs: "7rem", md: "10rem" },
              fontWeight: 900,
              lineHeight: 1,
              mb: 2,
              fontFamily: "'Georgia', serif",
              letterSpacing: "-4px",
            }}
          >
            404
          </Typography>

          {/* Confused Church Doodle */}
          <Box sx={{ display: "flex", justifyContent: "center", my: 2 }}>
            <ConfusedChurch />
          </Box>

          {/* Message */}
          <Typography
            variant="h4"
            sx={{
              fontWeight: 700,
              color: "#333",
              mb: 1,
              fontFamily: "'Georgia', serif",
              fontSize: { xs: "1.4rem", md: "1.8rem" },
            }}
          >
            Oops! This page has wandered off...
          </Typography>

          {/* Squiggly underline */}
          <Box sx={{ display: "flex", justifyContent: "center", mb: 2 }}>
            <svg width="240" height="12" viewBox="0 0 240 12">
              <path
                d="M0 6 Q15 0 30 6 Q45 12 60 6 Q75 0 90 6 Q105 12 120 6 Q135 0 150 6 Q165 12 180 6 Q195 0 210 6 Q225 12 240 6"
                stroke="#FFD700"
                strokeWidth="2.5"
                fill="none"
                strokeLinecap="round"
                className="draw-line"
                style={{ animationDelay: "0.5s" }}
              />
            </svg>
          </Box>

          <Typography
            variant="body1"
            sx={{
              color: "#666",
              mb: 4,
              fontStyle: "italic",
              fontSize: { xs: "0.95rem", md: "1.1rem" },
            }}
          >
            Even the best shepherds lose a sheep sometimes
          </Typography>

          {/* Take Me Home button */}
          <Button
            className="sketchy-button"
            onClick={() => navigate("/dashboard")}
            sx={{
              bgcolor: "#FFF8E7",
              color: "#333",
              px: 4,
              py: 1.5,
              fontSize: "1.1rem",
              fontWeight: 700,
              textTransform: "none",
              fontFamily: "'Georgia', serif",
              "&:hover": {
                bgcolor: "#FFD700",
              },
            }}
          >
            Take me home
          </Button>
        </Box>
      </Box>
    </>
  );
}
