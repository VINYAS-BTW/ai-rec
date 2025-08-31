"use client";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import gsap from "gsap";
import { motion } from "framer-motion";

import musicImg from "../assets/images/music.jpg";
import moviesImg from "../assets/images/movies.jpg";
import booksImg from "../assets/images/books.jpg";
import tvImg from "../assets/images/tv.jpg";
import ecommerceImg from "../assets/images/e-commerce.jpg";
import gamesImg from "../assets/images/games.jpg";
import foodImg from "../assets/images/food.jpg";

const categories = [
  { label: "Music", desc: "Personalized playlists and artist suggestions", img: musicImg },
  { label: "Movies", desc: "Tailored film picks for your mood", img: moviesImg },
  { label: "Books", desc: "Curated reads based on your interests", img: booksImg },
  { label: "TV Shows", desc: "Series recommendations you'll binge", img: tvImg },
  { label: "E-commerce", desc: "Smart product suggestions for you", img: ecommerceImg },
  { label: "Games", desc: "Find your next favorite game", img: gamesImg },
  { label: "Food", desc: "Discover dishes and restaurants nearby", img: foodImg },
];

const HeroSec = () => {
  const navigate = useNavigate();

  const mid = Math.ceil(categories.length / 2);
  const col1Items = categories.slice(0, mid);
  const col2Items = categories.slice(mid);

  const col1Ref = useRef(null);
  const col2Ref = useRef(null);

  useEffect(() => {
    const col1Height = col1Ref.current.scrollHeight / 2;
    const col2Height = col2Ref.current.scrollHeight / 2;

    // Column 1 - scroll down
    gsap.to(col1Ref.current, {
      y: col1Height,
      duration: 15,
      ease: "none",
      repeat: -1,
      modifiers: {
        y: gsap.utils.unitize((y) => parseFloat(y) % col1Height),
      },
    });

    // Column 2 - scroll up
    gsap.to(col2Ref.current, {
      y: -col2Height,
      duration: 15,
      ease: "none",
      repeat: -1,
      modifiers: {
        y: gsap.utils.unitize((y) => parseFloat(y) % -col2Height),
      },
    });
  }, []);

  const Card = ({ item }) => (
    <motion.div
      className="w-24 h-32 sm:w-28 sm:h-36 md:w-40 md:h-52 bg-white rounded-2xl shadow-md border border-gray-200 flex flex-col items-center text-center p-2 sm:p-3 -rotate-6"
      whileHover={{
        scale: 1.05,
        boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
      }}
      transition={{ type: "spring", stiffness: 200, damping: 15 }}
    >
      <img
        src={item.img}
        alt={item.label}
        className="w-full h-16 sm:h-20 md:h-28 object-cover rounded-lg mb-1 sm:mb-2"
      />
      <div className="text-xs sm:text-sm md:text-base font-semibold text-gray-800">
        {item.label}
      </div>
      <p className="text-[9px] sm:text-[10px] md:text-xs text-gray-500 mt-1">
        {item.desc}
      </p>
    </motion.div>
  );

  return (
    <section className="relative h-screen flex flex-col md:flex-row bg-gradient-to-b from-neutral-50 to-neutral-100 overflow-hidden">
      {/* LEFT SIDE */}
      <motion.div
        className="flex-1 flex flex-col justify-center px-4 sm:px-6 md:px-12 py-6 z-10"
        initial={{ opacity: 0, x: -300 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 1, ease: "easeOut" }}
      >
        <motion.h1
          className="text-3xl sm:text-4xl md:text-8xl font-extrabold leading-tight tracking-tight"
          initial={{ opacity: 0, x: -100 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.4, duration: 1.2, ease: "easeOut" }}
        >
          Decisions Made <span className="text-indigo-500 ">Effortless</span>
        </motion.h1>

        <motion.p
          className="mt-3 text-sm sm:text-base md:text-xl text-gray-600 max-w-lg md:pb-2 md:px-1"
          initial={{ opacity: 0, x: -40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.8, duration: 1.4, ease: "easeOut" }}
        >
          From everyday choices to big moves — we help you find clarity and act with confidence.
        </motion.p>

        <motion.div
          className="mt-5 flex gap-3 flex-wrap md:px-2"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.8, ease: "easeOut" }}
        >
          <motion.button
            whileHover={{ scale: 1.07 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => navigate("/dashboard")}
            className="px-5 py-2 sm:px-6 sm:py-3 bg-indigo-500 hover:bg-indigo-600 text-white rounded-full font-semibold transition-colors duration-200 text-sm sm:text-base shadow-md cursor-pointer"
          >
            Get Started
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.07 }}
            whileTap={{ scale: 0.95 }}
            className="px-5 py-2 sm:px-6 sm:py-3 border border-gray-400 hover:border-gray-600 rounded-full font-semibold transition-colors duration-200 text-sm sm:text-base shadow-sm cursor-pointer"
          >
            Learn More
          </motion.button>
        </motion.div>
      </motion.div>

      {/* RIGHT SIDE */}
      <div className="flex-1 flex justify-center items-center relative overflow-hidden py-4 sm:py-6">
        {/* Fade overlays */}
        <div className="pointer-events-none absolute top-0 left-0 w-full h-32 sm:h-20 bg-gradient-to-b from-neutral-100 to-transparent z-20" />
        <div className="pointer-events-none absolute bottom-0 left-0 w-full h-32 sm:h-20 bg-gradient-to-t from-neutral-100 to-transparent z-20" />

        {/* Rotated container */}
        <div className="flex gap-3 sm:gap-4 md:gap-6 rotate-6 origin-center">
          {/* Column 1 */}
          <div ref={col1Ref} className="flex flex-col gap-3 sm:gap-4 md:gap-6">
            {[...col1Items, ...col1Items].map((item, idx) => (
              <Card key={`col1-${idx}`} item={item} />
            ))}
          </div>

          {/* Column 2 */}
          <div ref={col2Ref} className="flex flex-col gap-3 sm:gap-4 md:gap-6">
            {[...col2Items, ...col2Items].map((item, idx) => (
              <Card key={`col2-${idx}`} item={item} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSec;
