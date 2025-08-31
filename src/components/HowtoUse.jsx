"use client";
import { motion } from "framer-motion";

const steps = [
  {
    number: "1",
    title: "Sign Up",
    desc: "Create your free account in just a few clicks.",
  },
  {
    number: "2",
    title: "Customize",
    desc: "Set your preferences so AiRec knows exactly what to recommend.",
  },
  {
    number: "3",
    title: "Get Insights",
    desc: "Receive tailored recommendations instantly and start making smarter decisions.",
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.25, delayChildren: 0.2 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 40 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } },
};

export default function HowtoUse() {
  return (
    <section className="py-20 bg-gray-50 relative overflow-hidden">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        {/* Heading */}
        <motion.div
          className="text-center mb-16"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.8 }}
        >
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900">
            How It Works
          </h2>
          <p className="mt-4 text-lg text-gray-600 max-w-2xl mx-auto">
            Getting started with AiRec is quick and effortless — here’s the journey.
          </p>
        </motion.div>

        {/* Steps */}
        <motion.div
          className="grid gap-12 md:grid-cols-3"
          variants={containerVariants}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.2 }}
        >
          {steps.map((step, i) => (
            <motion.div
              key={i}
              className="text-center group"
              variants={itemVariants}
              whileHover={{ scale: 1.05 }}
            >
              <div className="w-16 h-16 mx-auto rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-xl shadow-md group-hover:bg-indigo-200 transition-colors duration-300">
                {step.number}
              </div>
              <h3 className="mt-6 text-xl font-semibold text-gray-900">
                {step.title}
              </h3>
              <p className="mt-2 text-gray-600">{step.desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
