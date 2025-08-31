"use client";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import musicImg from "../assets/images/music.jpg";
import moviesImg from "../assets/images/movies.jpg";
import booksImg from "../assets/images/books.jpg";
import tvImg from "../assets/images/tv.jpg";
import ecommerceImg from "../assets/images/e-commerce.jpg";
import gamesImg from "../assets/images/games.jpg";
import foodImg from "../assets/images/food.jpg";

const categories = [
  {
    label: "Music",
    desc: "Personalized playlists and artist suggestions",
    img: musicImg,
  },
  {
    label: "Movies",
    desc: "Tailored film picks for your mood",
    img: moviesImg,
  },
  {
    label: "Books",
    desc: "Curated reads based on your interests",
    img: booksImg,
  },
  {
    label: "TV Shows",
    desc: "Series recommendations you'll binge",
    img: tvImg,
  },
  {
    label: "E-commerce",
    desc: "Smart product suggestions for you",
    img: ecommerceImg,
  },
  {
    label: "Games",
    desc: "Find your next favorite game",
    img: gamesImg,
  },
  {
    label: "Food",
    desc: "Discover dishes and restaurants nearby",
    img: foodImg,
  },
];

const HeroSec = () => {
  const navigate = useNavigate();

  return (
    <section className="bg-grid-light .mask-fade relative bg-gradient-to-b from-neutral-50 to-neutral-100 text-gray-900 overflow-hidden min-h-screen">
      {/* Hero Content */}
      <div className="absolute inset-0 bg-grid-light mask-fade"></div>
      <div className="relative z-20 flex flex-col items-center text-center px-6 pt-40 md:pt-44 pb-40">
        <motion.h1
          className="text-4xl md:text-6xl font-extrabold leading-tight"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.8 }}
        >
          Decisions Made <span className="text-indigo-500">Effortless</span>
        </motion.h1>

        <motion.p
          className="mt-6 text-lg md:text-xl text-gray-600 max-w-2xl"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.8 }}
        >
          From everyday choices to big moves — we help you find clarity and act
          with confidence.
        </motion.p>

        {/* CTA Buttons */}
        <motion.div
          className="mt-8 flex flex-row gap-4 justify-center flex-wrap"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.8 }}
        >
          <button
            onClick={() => navigate("/dashboard")}
            className="px-8 py-3 bg-indigo-500 hover:bg-indigo-600 hover:scale-105 text-white rounded-full font-semibold transition-all duration-200 cursor-pointer"
          >
            Get Started
          </button>
          <button className="px-8 py-3 border border-gray-400 hover:border-gray-600 hover:scale-105 rounded-full font-semibold transition-all duration-200 cursor-pointer">
            Learn More
          </button>
        </motion.div>
      </div>

      {/* Floating Marquee Cards */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.8 }}
        className="absolute bottom-0 w-full overflow-hidden py-8"
      >
        {/* Fades */}
        <div className="pointer-events-none absolute left-0 top-0 h-full w-24 bg-gradient-to-r from-neutral-50 to-transparent z-10" />
        <div className="pointer-events-none absolute right-0 top-0 h-full w-24 bg-gradient-to-l from-neutral-50 to-transparent z-10" />

        <motion.div
          className="flex gap-6 px-6"
          animate={{ x: ["0%", "-25%"] }}
          transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
        >
          {[...categories, ...categories].map((item, idx) => (
            <motion.div
              key={idx}
              className="flex-shrink-0 w-[200px] sm:w-[240px] h-[180px] bg-white rounded-2xl shadow-md border border-gray-200 flex flex-col items-center text-center p-4 cursor-pointer"
              whileHover={{
                scale: 1.05,
                boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
              }}
              transition={{ type: "spring", stiffness: 200, damping: 15 }}
            >
              <img
                src={item.img}
                alt={item.label}
                className="w-full h-24 object-cover rounded-lg mb-3"
              />
              <div className="text-base font-semibold text-gray-800">
                {item.label}
              </div>
              <p className="text-xs text-gray-500 mt-1">{item.desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </motion.div>
    </section>
  );
};

export default HeroSec;
