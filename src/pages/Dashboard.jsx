import React, { useState, useEffect } from "react";
import {
  Send as SendIcon,
  Mic as MicIcon,
  PhotoCamera as PhotoCameraIcon,
  AccountCircle as AccountCircleIcon,
  AutoAwesome as AutoAwesomeIcon,
  Movie as MovieIcon,
  MusicNote as MusicNoteIcon,
  MenuBook as MenuBookIcon,
  SportsEsports as SportsEsportsIcon,
  ShoppingCart as ShoppingCartIcon,
  Restaurant as RestaurantIcon,
  Menu as MenuIcon,
  Close as CloseIcon,
} from "@mui/icons-material";
// ...existing code...

export default function Hero() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);

  // sidebar state. initialize open on mount for desktop but allow user toggles
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 768 : true
  );

  // set initial state only (don't overwrite user toggles on resize)
  useEffect(() => {
    // if window size changed between render and mount, ensure reasonable default
    if (typeof window !== "undefined") {
      setSidebarOpen(window.innerWidth >= 768);
    }
    // no resize listener — let user toggle freely
  }, []);

  const fetchRecommendations = async () => {
    try {
      const res = await fetch("http://127.0.0.1:8000/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: input, k: 5 }),
      });
      const data = await res.json();

      setMessages((prev) => [
        ...prev,
        {
          type: "ai",
          category: data?.category,
          items: data?.recommendations || [],
        },
      ]);
    } catch (err) {
      console.error("Error fetching recommendations:", err);
      setMessages((prev) => [
        ...prev,
        { type: "ai", items: [{ title: "😢Something went wrong." }] },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = () => {
    if (!input.trim() || loading) return;
    setMessages((prev) => [...prev, { type: "user", text: input }]);
    setInput("");
    setLoading(true);
    setTimeout(fetchRecommendations, 600);
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const suggest = (text) => {
    setInput(text);
    // Optional: send immediately
    // handleSend();
  };

  // removed animated background (gsap + framer-motion) per request
  return (
    <div className="flex flex-col h-screen bg-gradient-to-b from-white to-gray-50 text-gray-800 relative">
      {/* Top accent (static) */}

      {/* Header */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Header sidebar toggle (moved to left) */}
            <button
              onClick={() => setSidebarOpen((s) => !s)}
              className="inline-flex items-center justify-center h-9 w-9 rounded-full bg-white border border-gray-200 text-sm text-gray-700 shadow-sm hover:bg-gray-50"
              aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
              title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
            >
              {sidebarOpen ? (
                <CloseIcon sx={{ fontSize: 18, color: "#374151" }} />
              ) : (
                <MenuIcon sx={{ fontSize: 18, color: "#374151" }} />
              )}
            </button>

           
            <div>
              <p className="text-2xl font-extrabold bg-gradient-to-r from-blue-600 to-indigo-500 bg-clip-text text-transparent leading-none">
                AiRec
              </p>
              <p className="text-xs text-gray-500 -mt-0.5">
                Personalized picks that feel yours
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Persistent header sidebar toggle */}
            

            {/* New chat button */}
            <button
              onClick={() => {
                setMessages([]);
                setInput("");
                // on mobile close the sidebar so new chat is visible
                if (typeof window !== "undefined" && window.innerWidth < 768) {
                  setSidebarOpen(false);
                }
              }}
              className="inline-flex items-center gap-2 px-3 py-1 rounded-3xl bg-white border border-gray-200 text-sm text-gray-700 shadow-sm hover:shadow-md   cursor-pointer"
              title="New chat"
            >
              <span className="font-medium">New chat</span>
            </button>

            <AccountCircleIcon sx={{ fontSize: 40, color: "#2563eb" }} />
          </div>
        </div>
      </header>

      {/* Content area: sidebar + main */}
      <div className="flex-1 flex overflow-hidden">
        {/* Overlay when mobile open */}
        {sidebarOpen && (
          <div
            className="md:hidden fixed inset-0 z-20 bg-black/30"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <aside
          aria-hidden={!sidebarOpen}
          className={`
            fixed md:static left-0 top-0 z-30 h-full md:h-auto
            w-72 md:w-72 transform transition-transform duration-300
            bg-white/95 backdrop-blur border-r border-gray-100 shadow-sm
            ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
            md:flex md:flex-col md:gap-4 md:p-4
          `}
        >
          <div className="hidden md:flex items-center gap-3 mb-3 relative">
            <div className="h-9 w-9 rounded-xl bg-blue-600/10 flex items-center justify-center">
              <AutoAwesomeIcon sx={{ fontSize: 20, color: "#2563eb" }} />
            </div>
            <div>
              <p className="text-lg font-semibold">Explore</p>
              <p className="text-xs text-gray-500 -mt-0.5">Quick access</p>
            </div>
            {/* sidebar header toggle removed - use header toggle on the left */}
          </div>

          <nav className="px-3 md:px-0 py-3 md:py-0 space-y-2 md:flex-1 overflow-auto">
            <SidebarItem
              icon={<AutoAwesomeIcon sx={{ fontSize: 18 }} />}
              label="Discover"
              active
            />
            <SidebarItem
              icon={<MusicNoteIcon sx={{ fontSize: 18 }} />}
              label="Music"
            />
            <SidebarItem
              icon={<MovieIcon sx={{ fontSize: 18 }} />}
              label="Movies"
            />
            <SidebarItem
              icon={<MenuBookIcon sx={{ fontSize: 18 }} />}
              label="Books"
            />
            <SidebarItem
              icon={<SportsEsportsIcon sx={{ fontSize: 18 }} />}
              label="Games"
            />
            <SidebarItem
              icon={<ShoppingCartIcon sx={{ fontSize: 18 }} />}
              label="Shopping"
            />
            <SidebarItem
              icon={<RestaurantIcon sx={{ fontSize: 18 }} />}
              label="Food"
            />
          </nav>
        </aside>

        {/* Main area */}
        <main
          className={`flex-1 overflow-auto ${
            sidebarOpen ? "md:ml-72" : "md:ml-0"
          }`}
        >
          <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 md:py-8">
            {messages.length === 0 ? (
              <EmptyState onSuggest={suggest} />
            ) : (
              <div className="space-y-6">
                {messages.map((msg, index) => (
                  <Message key={index} msg={msg} />
                ))}

                {loading && <TypingBubble />}
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Composer */}
      <footer className="sticky bottom-0 backdrop-blur ">
        <div className="max-w-5xl mx-auto px-4 md:px-6 py-3">
          <div
            className="
        flex items-end gap-2 sm:gap-3 bg-gray-100 rounded-xl sm:rounded-3xl
        px-3 sm:px-4 py-2 sm:py-3 border border-gray-200 shadow-sm
        focus-within:ring-2 focus-within:ring-blue-200
        transition-all duration-300 ease-in-out md:rounded-4xl
        md:max-w-[60%] md:mx-auto md:hover:max-w-[90%] md:focus-within:max-w-[90%]
      "
          >
            {/* Attach Image */}
            <button
              type="button"
              className="p-2 rounded-lg hover:bg-white transition-colors text-gray-500"
              aria-label="Attach image"
            >
              <PhotoCameraIcon sx={{ fontSize: 22 }} />
            </button>

            {/* Textarea */}
            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask for music, movies, books, games, food, shopping..."
              className="
          flex-1 bg-transparent outline-none resize-none
          text-sm sm:text-base leading-6 sm:leading-7
          placeholder:text-gray-400 px-1 py-1 max-h-36
        "
            />

            {/* Voice Input */}
            <button
              type="button"
              className="p-2 rounded-lg hover:bg-white transition-colors text-gray-500"
              aria-label="Voice input"
            >
              <MicIcon sx={{ fontSize: 22 }} />
            </button>

            {/* Send Button */}
            <button
              onClick={handleSend}
              disabled={!input.trim() || loading}
              className="inline-flex items-center justify-center h-9 w-9 sm:h-10 sm:w-10 rounded-4xl bg-blue-600 text-white shadow-sm hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition"
              aria-label="Send message"
            >
              {loading ? (
                <svg
                  className="animate-spin h-5 w-5 text-white"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-20"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-90"
                    d="M22 12a10 10 0 0 1-10 10"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                </svg>
              ) : (
                <SendIcon sx={{ fontSize: 20 }} />
              )}
            </button>
          </div>

          <p className="text-center text-xs text-gray-500 mt-2">
            AI may display inaccurate info. Please verify important details.
          </p>
        </div>
      </footer>
    </div>
  );
}
// ...existing code...

/* ——— Components ——— */

function EmptyState({ onSuggest }) {
  const suggestions = [
    {
      label: "Make me a 5-song playlist for focus",
      icon: <MusicNoteIcon sx={{ fontSize: 18 }} />,
    },
    {
      label: "Recommend 3 feel-good movies tonight",
      icon: <MovieIcon sx={{ fontSize: 18 }} />,
    },
    {
      label: "Suggest sci-fi books like Dune",
      icon: <MenuBookIcon sx={{ fontSize: 18 }} />,
    },
    {
      label: "What cozy games should I try?",
      icon: <SportsEsportsIcon sx={{ fontSize: 18 }} />,
    },
    {
      label: "Find noise-cancelling headphones under ₹5k",
      icon: <ShoppingCartIcon sx={{ fontSize: 18 }} />,
    },
    {
      label: "Best biryani spots near me",
      icon: <RestaurantIcon sx={{ fontSize: 18 }} />,
    },
  ];

  return (
    <div className="text-center">
      <h1 className="text-3xl font-semibold mb-2">
        <span className="bg-gradient-to-r from-blue-600 to-indigo-500 bg-clip-text text-transparent">
          Hello User!
        </span>
      </h1>
      <p className="text-base md:text-lg text-gray-500">
        Tell me what you're into — I'll tailor recommendations instantly.
      </p>

      <div
        className="
      grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4
      auto-rows-[150px] gap-4 mt-8 max-w-5xl mx-auto
    "
      >
        {suggestions.map((s, i) => (
          <BentoCard
            key={i}
            icon={s.icon}
            text={s.label}
            onClick={() => onSuggest(s.label)}
            className={
              i === 0
                ? "lg:col-span-2 lg:row-span-3"
                : i === 2
                ? "lg:row-span-2"
                : i === 5
                ? "lg:col-span-1"
                : ""
            }
          />
        ))}
      </div>
    </div>
  );
}
function BentoCard({ icon, text, onClick, className = "" }) {
  const [pos, setPos] = useState({ x: 50, y: 50 });

  const handleMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setPos({ x, y });
  };

  return (
    <div
      onClick={onClick}
      onMouseMove={handleMouseMove}
      tabIndex={0}
      className={`
        relative overflow-hidden rounded-4xl cursor-pointer
        bg-gray-50 border border-gray-200 shadow-sm
        transform transition-all duration-300 will-change-transform
        hover:-translate-y-1 hover:scale-[1.01] hover:shadow-lg
        focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-100
        flex flex-col justify-between p-4 group ${className}
      `}
    >
      {/* Hover gradient that follows cursor */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none blur-[2px]"
        style={{
          background: `radial-gradient(circle at ${pos.x}% ${pos.y}%, rgba(59,130,246,0.20), transparent 55%)`,
        }}
      />

      <div className="relative z-10 text-blue-600">{icon}</div>
      <p className="relative z-10 text-sm sm:text-base font-medium text-gray-700 group-hover:text-gray-900 transition-colors">
        {text}
      </p>
    </div>
  );
}

function QuickPromptChip({ icon, text, onClick }) {
  return (
    <button
      onClick={onClick}
      className="group w-full text-left bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm hover:shadow-md transition flex items-center gap-3"
    >
      <span className="text-blue-600">{icon}</span>
      <span className="text-sm text-gray-700 group-hover:text-gray-900">
        {text}
      </span>
    </button>
  );
}

// new: SidebarItem component used by the sidebar
function SidebarItem({ icon, label, active = false, sidebarOpen = true }) {
  return (
    <button
      className={`relative w-full flex items-center gap-3 transition-all duration-200 rounded-lg overflow-hidden ${
        active
          ? "bg-gradient-to-r from-blue-600/10 to-indigo-50 border border-blue-100 text-blue-700 shadow-sm"
          : "hover:bg-gray-50 text-gray-700"
      } ${
        sidebarOpen ? "px-3 py-2 justify-start" : "px-2 py-2 justify-center"
      }`}
    >
      {/* active left accent */}
      {active && (
        <span
          className={`absolute left-0 top-0 h-full rounded-tr-lg rounded-br-lg ${
            sidebarOpen ? "w-1" : "w-1"
          }`}
          style={{ background: "linear-gradient(180deg,#2563eb,#7c3aed)" }}
        />
      )}

      <span className="text-blue-600 z-10">{icon}</span>
      {sidebarOpen && <span className="text-sm font-medium z-10">{label}</span>}
    </button>
  );
}

function Message({ msg }) {
  const isUser = msg.type === "user";
  const IconWrap = isUser ? AccountCircleIcon : CategoryIcon(msg.category);

  return (
    <div
      className={`flex items-start gap-3 ${
        isUser ? "flex-row-reverse" : "flex-row"
      }`}
    >
      <div
        className={`h-10 w-10 rounded-2xl flex items-center justify-center shadow-sm ${
          isUser ? "bg-blue-600 text-white" : "bg-blue-600/10 text-blue-600"
        }`}
      >
        <IconWrap sx={{ fontSize: 22 }} />
      </div>

      <div
        className={`max-w-[80%] rounded-4xl shadow-sm ${
          isUser
            ? "bg-blue-50 text-gray-900 rounded-br-sm"
            : "bg-white text-gray-800 rounded-tl-sm border border-gray-100"
        }`}
      >
        {msg.items ? (
          <AIResultBlock category={msg.category} items={msg.items} />
        ) : (
          <p className="px-4 py-3 text-sm leading-relaxed">{msg.text}</p>
        )}
      </div>
    </div>
  );
}

function CategoryIcon(category) {
  switch ((category || "").toLowerCase()) {
    case "music":
      return MusicNoteIcon;
    case "movies":
    case "movie":
      return MovieIcon;
    case "books":
    case "book":
      return MenuBookIcon;
    case "games":
    case "gaming":
      return SportsEsportsIcon;
    case "e-commerce":
    case "shopping":
    case "products":
      return ShoppingCartIcon;
    case "food":
    case "restaurants":
      return RestaurantIcon;
    default:
      return AutoAwesomeIcon;
  }
}

function AIResultBlock({ category, items }) {
  const hasCards = Array.isArray(items) && items.length > 0;

  if (!hasCards) {
    return (
      <p className="px-4 py-3 text-sm text-gray-600"> 😢 No results found.</p>
    );
  }

  return (
    <div className="px-3 sm:px-4 py-3">
      {category && (
        <div className="mb-2">
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 bg-blue-50 border border-blue-100 px-2 py-1 rounded-full">
            {React.createElement(CategoryIcon(category), {
              sx: { fontSize: 14 },
            })}
            {String(category).charAt(0).toUpperCase() +
              String(category).slice(1)}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {items.map((item, idx) => (
          <ResultCard key={idx} item={item} />
        ))}
      </div>
    </div>
  );
}

function ResultCard({ item }) {
  const title = item?.title || item?.track_name || "Untitled";
  const desc = item?.desc || item?.overview || item?.artist || "";
  const img = item?.img || item?.poster || item?.image_url || "";

  return (
    <div className="group bg-gray-50 border border-gray-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition">
      {img ? (
        <div className="relative">
          <img
            src={img}
            alt={title}
            className="w-full h-40 object-cover"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition" />
        </div>
      ) : (
        <div className="w-full h-40 bg-white flex items-center justify-center text-gray-300">
          <AutoAwesomeIcon />
        </div>
      )}

      <div className="p-3">
        <h3 className="text-sm font-semibold text-gray-900 line-clamp-2">
          {title}
        </h3>
        {desc && (
          <p className="text-xs text-gray-600 mt-1 line-clamp-2">{desc}</p>
        )}
        {/* Optional CTA area if backend returns links */}
        {item?.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center text-xs text-blue-600 mt-2 hover:underline"
          >
            Open
          </a>
        )}
      </div>
    </div>
  );
}

function TypingBubble() {
  return (
    <div className="flex items-start gap-3">
      <div className="h-10 w-10 rounded-xl bg-blue-600/10 text-blue-600 flex items-center justify-center shadow-sm">
        <AutoAwesomeIcon sx={{ fontSize: 22 }} />
      </div>
      <div className="bg-white border border-gray-100 px-4 py-3 rounded-4xl rounded-tl-sm shadow flex items-center gap-2">
        <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></span>
        <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce [animation-delay:120ms]"></span>
        <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce [animation-delay:240ms]"></span>
      </div>
    </div>
  );
}
