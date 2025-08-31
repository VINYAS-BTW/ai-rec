"use client";
import { motion } from "framer-motion";

const features = [
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    title: "Clear Insights",
    desc: "We cut through the noise and give you the facts that matter — no jargon, no fluff.",
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 1.343-3 3v6h6v-6c0-1.657-1.343-3-3-3z" />
      </svg>
    ),
    title: "Effortless Flow",
    desc: "Everything’s designed to feel natural — so you can focus on doing, not figuring things out.",
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    ),
    title: "Proven in Action",
    desc: "Built from real‑world experience and refined through constant feedback.",
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.2, delayChildren: 0.2 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 40 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } },
};

export const Features = () => {
  return (
    <section className="py-20 bg-gradient-to-b from-neutral-100 to-neutral-50 overflow-x-hidden">
      <div className="max-w-7xl w-full mx-auto px-6 lg:px-8">
        <motion.div
          className="text-center mb-16"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900">
            Why People Choose <span className="text-indigo-600">AiRec</span>
          </h2>
          <p className="mt-4 text-lg text-gray-600 max-w-2xl mx-auto">
            Crafted with care, Implicated with  Ai, tested in the real world, and built to make your everyday decisions smoother.
          </p>
        </motion.div>

        <motion.div
          className="grid gap-12 md:grid-cols-3"
          variants={containerVariants}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.2 }}
        >
          {features.map((f, i) => (
            <motion.div
              key={i}
              className="text-center"
              variants={itemVariants}
              whileHover={{ scale: 1.05, transition: { type: "spring", stiffness: 200 } }}
            >
              <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-indigo-100 text-indigo-600 mb-6 overflow-hidden">
                {f.icon}
              </div>
              <h3 className="text-xl font-semibold text-gray-900">{f.title}</h3>
              <p className="mt-3 text-gray-600">{f.desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
};
