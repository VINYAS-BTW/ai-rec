"use client";
import React from "react";
import { motion } from "framer-motion";

const founders = [
  { 
    img: "../src/assets/image (3).png", 
    alt: "Rohit R Bhat", 
    name: "Rohit R Bhat", 
    role: "Co-Founder & Vision Strategist",
    tagline: "Shaping the big picture with bold ideas."
  },
  { 
    img: "../src/assets/image.png", 
    alt: "Sai Vinyas BS", 
    name: "Sai Vinyas BS", 
    role: "Co-Founder & Technology Lead",
    tagline: "Turning complex code into seamless experiences."
  },
  { 
    img: "../src/assets/image (1).png", 
    alt: "Sourabh V Katti", 
    name: "Sourabh V Katti", 
    role: "Co-Founder & Operations Head",
    tagline: "Keeping the engine running at full speed."
  },
  { 
    img: "../src/assets/image (2).png", 
    alt: "Sachidanand NC", 
    name: "Sachidanand NC", 
    role: "Co-Founder & Product Innovator",
    tagline: "Inventing features users didn’t know they needed."
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.15, delayChildren: 0.2 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 40 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } },
};

export default function AboutUS() {
  return (
    <section className="py-20 bg-gradient-to-b from-gray-50 to-white overflow-x-hidden">
      <div className="max-w-6xl mx-auto px-6 lg:px-8">
        {/* Heading */}
        <motion.div
          className="text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900">
            Meet Our Founders
          </h2>
          <p className="mt-4 text-lg text-gray-600 max-w-2xl mx-auto">
            The driving force behind our vision — a team of passionate innovators dedicated to delivering excellence.
          </p>
        </motion.div>

        {/* Grid */}
        <motion.div
          className="grid gap-12 sm:grid-cols-2 lg:grid-cols-4"
          variants={containerVariants}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.2 }}
        >
          {founders.map((f, i) => (
            <motion.div
              key={i}
              className="group bg-white rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 p-6 flex flex-col items-center text-center border border-transparent hover:border-indigo-200"
              variants={cardVariants}
              whileHover={{ y: -5 }}
            >
              <div className="relative w-32 h-32 rounded-full overflow-hidden ring-4 ring-indigo-100 group-hover:ring-indigo-300 transition-all duration-300">
                <img
                  src={f.img}
                  alt={f.alt}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
              </div>
              <h3 className="mt-6 text-xl font-semibold text-gray-900">{f.name}</h3>
              <p className="mt-1 text-indigo-600 font-medium">{f.role}</p>
              <p className="mt-2 text-gray-500 text-sm">{f.tagline}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
