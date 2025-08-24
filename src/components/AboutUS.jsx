"use client";
import React from "react";
import { motion } from "framer-motion";

const founders = [
  { img: "../src/assets/image (3).png", alt: "Rohit R Bhat", name: "Rohit R Bhat", role: "Co-Founder & Vision Strategist" },
  { img: "../src/assets/image.png", alt: "Sai Vinyas BS", name: "Sai Vinyas BS", role: "Co-Founder & Technology Lead" },
  { img: "../src/assets/image (1).png", alt: "Sourabh V Katti", name: "Sourabh V Katti", role: "Co-Founder & Operations Head" },
  { img: "../src/assets/image (2).png", alt: "Sachidanand NC", name: "Sachidanand NC", role: "Co-Founder & Product Innovator" },
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

const AboutUS = () => {
  return (
    <section className="py-20 bg-gray-50 overflow-x-hidden">
      <div className="max-w-5xl mx-auto px-6 lg:px-8">
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
          className="grid gap-12 sm:grid-cols-2"
          variants={containerVariants}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.2 }}
        >
          {founders.map((f, i) => (
            <motion.div
              key={i}
              className="text-center cursor-pointer"
              variants={cardVariants}
              transition={{ type: "spring", stiffness: 200, damping: 15 }}
            >
              <div className="w-32 h-32 mx-auto rounded-full bg-indigo-100 flex items-center justify-center overflow-hidden shadow-sm">
                <img
                  src={f.img}
                  alt={f.alt}
                  className="w-full h-full object-cover"
                />
              </div>
              <h3 className="mt-6 text-xl font-semibold text-gray-900">{f.name}</h3>
              <p className="mt-2 text-gray-600">{f.role}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
};

export default AboutUS;
