import { Box, Typography, Button } from "@mui/material";
import { useNavigate } from "react-router-dom";

// -- Confused person with phone SVG --
function ConfusedPerson() {
  return (
    <svg width="160" height="200" viewBox="0 0 160 200" fill="none" className="person-wobble">
      {/* Head */}
      <circle cx="80" cy="42" r="22" stroke="#333" strokeWidth="2.5" fill="#FFF8E7" strokeLinecap="round" className="draw-line" />
      {/* Confused eyes */}
      <circle cx="72" cy="38" r="3" fill="#333" className="blink-eye" />
      <circle cx="88" cy="38" r="3" fill="#333" className="blink-eye" />
      {/* Raised eyebrow */}
      <path d="M66 32 Q72 28 78 32" stroke="#333" strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M82 32 Q88 28 94 32" stroke="#333" strokeWidth="2" strokeLinecap="round" fill="none" />
      {/* Confused mouth */}
      <path d="M72 50 Q76 46 80 50 Q84 54 88 50" stroke="#333" strokeWidth="2" strokeLinecap="round" fill="none" />
      {/* Body */}
      <path d="M80 64 L80 130" stroke="#333" strokeWidth="2.5" strokeLinecap="round" className="draw-line" />
      {/* Arms - one holding phone */}
      <path d="M80 85 L50 105" stroke="#333" strokeWidth="2.5" strokeLinecap="round" className="draw-line" />
      <path d="M80 85 L115 75" stroke="#333" strokeWidth="2.5" strokeLinecap="round" className="draw-line" />
      {/* Phone in right hand */}
      <rect x="108" y="62" width="16" height="26" rx="3" stroke="#333" strokeWidth="2" fill="#6B4C9A" opacity="0.5" className="draw-line" />
      <line x1="112" y1="82" x2="120" y2="82" stroke="#333" strokeWidth="1.5" strokeLinecap="round" />
      {/* Legs */}
      <path d="M80 130 L60 185" stroke="#333" strokeWidth="2.5" strokeLinecap="round" className="draw-line" />
      <path d="M80 130 L100 185" stroke="#333" strokeWidth="2.5" strokeLinecap="round" className="draw-line" />
      {/* Feet */}
      <path d="M60 185 L48 188" stroke="#333" strokeWidth="3" strokeLinecap="round" className="draw-line" />
      <path d="M100 185 L112 188" stroke="#333" strokeWidth="3" strokeLinecap="round" className="draw-line" />
      {/* Scratch marks (confusion) */}
      <g className="float-item" style={{ animationDuration: "2s" }}>
        <line x1="98" y1="20" x2="102" y2="14" stroke="#CE1126" strokeWidth="2" strokeLinecap="round" />
        <line x1="104" y1="22" x2="108" y2="16" stroke="#CE1126" strokeWidth="2" strokeLinecap="round" />
        <line x1="110" y1="24" x2="114" y2="18" stroke="#CE1126" strokeWidth="2" strokeLinecap="round" />
      </g>
      {/* Question mark */}
      <text x="42" y="95" fontSize="20" fill="#FFD700" fontWeight="bold" className="float-item" style={{ animationDelay: "0.3s" }}>?</text>
    </svg>
  );
}

// -- Floating music note --
function MusicNote({ x, y, delay, color }: { x: number; y: number; delay: string; color: string }) {
  return (
    <svg
      width="24" height="30" viewBox="0 0 24 30" fill="none"
      className="float-item"
      style={{ position: "absolute", left: `${x}%`, top: `${y}%`, animationDelay: delay, animationDuration: "5s" }}
    >
      <path d="M8 24 C4 24 2 22 2 19 C2 16 4 14 8 14 C10 14 12 15 12 17 L12 4" stroke={color} strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <path d="M12 4 L22 2 L22 10 L12 12" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

// -- Small cross doodle --
function SmallCross({ x, y, delay, color }: { x: number; y: number; delay: string; color: string }) {
  return (
    <svg
      width="20" height="24" viewBox="0 0 20 24" fill="none"
      className="float-item"
      style={{ position: "absolute", left: `${x}%`, top: `${y}%`, animationDelay: delay, animationDuration: "6s" }}
    >
      <line x1="10" y1="2" x2="10" y2="22" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      <line x1="3" y1="8" x2="17" y2="8" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

// -- Winding path SVG --
function WindingPath() {
  return (
    <svg width="300" height="60" viewBox="0 0 300 60" style={{ margin: "16px auto", display: "block" }}>
      <path
        d="M0 30 Q30 5 60 30 Q90 55 120 30 Q150 5 180 30 Q210 55 240 30 Q270 5 300 30"
        stroke="#CE1126"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
        strokeDasharray="600"
        strokeDashoffset="600"
        className="winding-path"
      />
      {/* Small footprints along path */}
      <circle cx="30" cy="18" r="2.5" fill="#006B3F" opacity="0.5" className="footprint" style={{ animationDelay: "1.5s" }} />
      <circle cx="90" cy="42" r="2.5" fill="#006B3F" opacity="0.5" className="footprint" style={{ animationDelay: "2s" }} />
      <circle cx="150" cy="18" r="2.5" fill="#006B3F" opacity="0.5" className="footprint" style={{ animationDelay: "2.5s" }} />
      <circle cx="210" cy="42" r="2.5" fill="#006B3F" opacity="0.5" className="footprint" style={{ animationDelay: "3s" }} />
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
          25% { transform: translateY(-16px) rotate(4deg); }
          50% { transform: translateY(-6px) rotate(-2deg); }
          75% { transform: translateY(-20px) rotate(3deg); }
        }
        @keyframes wobble {
          0%, 100% { transform: rotate(0deg) translateX(0); }
          20% { transform: rotate(-2deg) translateX(-3px); }
          40% { transform: rotate(1deg) translateX(2px); }
          60% { transform: rotate(-1deg) translateX(-2px); }
          80% { transform: rotate(2deg) translateX(3px); }
        }
        @keyframes draw {
          from { stroke-dashoffset: 1000; }
          to { stroke-dashoffset: 0; }
        }
        @keyframes pathDraw {
          from { stroke-dashoffset: 600; }
          to { stroke-dashoffset: 0; }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(24px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes kenteShift {
          0% { background-position: 0% 0%; }
          100% { background-position: 200% 0%; }
        }
        @keyframes drumbeat {
          0%, 100% { transform: scale(1); }
          10% { transform: scale(1.06); }
          20% { transform: scale(1); }
          30% { transform: scale(1.04); }
          40% { transform: scale(1); }
        }
        @keyframes blinkEye {
          0%, 90%, 100% { transform: scaleY(1); }
          95% { transform: scaleY(0.1); }
        }
        @keyframes kenteStripeIn {
          from { width: 0; }
          to { width: 100%; }
        }
        @keyframes footprintFade {
          from { opacity: 0; transform: scale(0); }
          to { opacity: 0.5; transform: scale(1); }
        }
        @keyframes dotBg {
          0% { background-position: 0 0; }
          100% { background-position: 22px 22px; }
        }
        .float-item {
          animation: float 4s ease-in-out infinite;
        }
        .person-wobble {
          animation: wobble 4s ease-in-out infinite;
          transform-origin: bottom center;
        }
        .draw-line {
          stroke-dasharray: 1000;
          stroke-dashoffset: 1000;
          animation: draw 2s ease forwards;
        }
        .blink-eye {
          animation: blinkEye 5s ease-in-out infinite;
          transform-origin: center;
        }
        .winding-path {
          animation: pathDraw 2.5s ease forwards 0.5s;
        }
        .footprint {
          opacity: 0;
          animation: footprintFade 0.5s ease forwards;
        }
        .kente-text-web {
          background: repeating-linear-gradient(
            90deg,
            #FFD700 0px, #FFD700 10px,
            #CE1126 10px, #CE1126 20px,
            #006B3F 20px, #006B3F 30px,
            #FF8C00 30px, #FF8C00 40px,
            #000 40px, #000 50px
          );
          background-size: 200% 100%;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: kenteShift 3.5s linear infinite;
        }
        .drumbeat-button {
          animation: drumbeat 1.8s ease-in-out infinite;
          border: 3px solid #333;
          border-radius: 14px 8px 12px 10px;
          transition: background-color 0.3s ease;
        }
        .drumbeat-button:hover {
          background-color: #FFD700 !important;
        }
        .kente-divider {
          height: 6px;
          background: repeating-linear-gradient(
            90deg,
            #FFD700 0px, #FFD700 16px,
            #006B3F 16px, #006B3F 32px,
            #CE1126 32px, #CE1126 48px,
            #000 48px, #000 56px,
            #FF8C00 56px, #FF8C00 72px
          );
          border-radius: 3px;
          animation: kenteStripeIn 1.5s ease forwards;
          overflow: hidden;
        }
        .dot-bg-web {
          background-image: radial-gradient(circle, #00000006 1.5px, transparent 1.5px);
          background-size: 22px 22px;
          animation: dotBg 10s linear infinite;
        }
      `}</style>
      <Box
        className="dot-bg-web"
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
        {/* Floating music notes and crosses */}
        <MusicNote x={8} y={12} delay="0s" color="#FFD700" />
        <MusicNote x={85} y={18} delay="1.5s" color="#CE1126" />
        <MusicNote x={75} y={70} delay="0.8s" color="#006B3F" />
        <SmallCross x={15} y={65} delay="0.5s" color="#6B4C9A" />
        <SmallCross x={88} y={45} delay="2s" color="#FFD700" />
        <SmallCross x={5} y={35} delay="1s" color="#FF8C00" />
        <MusicNote x={50} y={80} delay="2.2s" color="#FF8C00" />
        <SmallCross x={60} y={8} delay="1.8s" color="#006B3F" />

        {/* Main content */}
        <Box
          sx={{
            textAlign: "center",
            animation: "fadeInUp 0.8s ease forwards",
            zIndex: 1,
            maxWidth: 500,
          }}
        >
          {/* 404 Text */}
          <Typography
            className="kente-text-web"
            sx={{
              fontSize: { xs: "6rem", md: "9rem" },
              fontWeight: 900,
              lineHeight: 1,
              mb: 1,
              fontFamily: "'Georgia', serif",
              letterSpacing: "-3px",
            }}
          >
            404
          </Typography>

          {/* Kente Divider */}
          <Box className="kente-divider" sx={{ mx: "auto", maxWidth: 260, mb: 3 }} />

          {/* Confused Person */}
          <Box sx={{ display: "flex", justifyContent: "center", my: 2 }}>
            <ConfusedPerson />
          </Box>

          {/* Winding Path */}
          <WindingPath />

          {/* Message */}
          <Typography
            variant="h4"
            sx={{
              fontWeight: 700,
              color: "#333",
              mb: 1,
              fontFamily: "'Georgia', serif",
              fontSize: { xs: "1.3rem", md: "1.7rem" },
            }}
          >
            Ei! You've taken a wrong turn...
          </Typography>

          {/* Squiggly underline */}
          <Box sx={{ display: "flex", justifyContent: "center", mb: 1.5 }}>
            <svg width="200" height="10" viewBox="0 0 200 10">
              <path
                d="M0 5 Q12.5 0 25 5 Q37.5 10 50 5 Q62.5 0 75 5 Q87.5 10 100 5 Q112.5 0 125 5 Q137.5 10 150 5 Q162.5 0 175 5 Q187.5 10 200 5"
                stroke="#6B4C9A"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
                className="draw-line"
                style={{ animationDelay: "0.6s" }}
              />
            </svg>
          </Box>

          <Typography
            variant="body1"
            sx={{
              color: "#666",
              mb: 4,
              fontStyle: "italic",
              fontSize: { xs: "0.9rem", md: "1.05rem" },
            }}
          >
            Don't worry, God's GPS never fails
          </Typography>

          {/* CTA Button with drumbeat pulse */}
          <Button
            className="drumbeat-button"
            onClick={() => navigate("/")}
            sx={{
              bgcolor: "#FFF8E7",
              color: "#333",
              px: 4,
              py: 1.5,
              fontSize: "1.05rem",
              fontWeight: 700,
              textTransform: "none",
              fontFamily: "'Georgia', serif",
              "&:hover": {
                bgcolor: "#FFD700",
              },
            }}
          >
            Find my way home
          </Button>
        </Box>
      </Box>
    </>
  );
}
