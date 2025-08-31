"use client";
import { motion } from "framer-motion";

const features = [
  {
    icon: "🤖",
    title: "AI‑Driven Recommendations",
    desc: "Delivers personalized suggestions in real‑time, adapting to your preferences and past interactions.",
  },
  {
    icon: "📊",
    title: "Smart Data Insights",
    desc: "Analyzes trends and patterns to give you actionable insights — not just raw numbers.",
  },
  {
    icon: "⚡",
    title: "Lightning‑Fast Search",
    desc: "Find exactly what you need in milliseconds with our optimized AI search engine.",
  },
  {
    icon: "🔄",
    title: "Seamless Integration",
    desc: "Connects effortlessly with your existing tools, APIs, and workflows.",
  },
  {
    icon: "🛡️",
    title: "Privacy‑First Design",
    desc: "Your data stays secure with end‑to‑end encryption and transparent handling policies.",
  },
  {
    icon: "📱",
    title: "Cross‑Platform Access",
    desc: "Use AiRec anywhere — desktop, mobile, or embedded in your own applications.",
  },
];

export const Features = () => {
  return (
    <section className="relative py-20 bg-gradient-to-b from-neutral-100 to-neutral-50">
      <div className="max-w-4xl mx-auto px-6">
        {/* Heading */}
        <motion.div
          className="text-center mb-16"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.8 }}
        >
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900">
            Why People Choose <span className="text-indigo-600">AiRec</span>
          </h2>
          <p className="mt-4 text-lg text-gray-600 max-w-2xl mx-auto">
            Crafted with care, powered by AI, tested in the real world, and built to make your everyday decisions smoother.
          </p>
        </motion.div>

        {/* Path line */}
        <div className="absolute left-1/2 top-40 bottom-20 w-1 bg-gradient-to-b from-indigo-200 to-indigo-500 -translate-x-1/2 rounded-full" />

        {/* Features */}
        <div className="space-y-24 relative">
          {features.map((f, i) => (
            <motion.div
              key={i}
              className={`flex items-center gap-8 ${i % 2 === 0 ? "flex-row" : "flex-row-reverse"}`}
              initial={{ opacity: 0, y: 50 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.6, delay: i * 0.2 }}
            >
              {/* Icon bubble */}
              <div className="flex-shrink-0 h-16 w-16 rounded-full bg-indigo-100 text-2xl flex items-center justify-center text-indigo-600 shadow-lg z-10">
                {f.icon}
              </div>

              {/* Text */}
              <div className="bg-white rounded-xl shadow-md p-6 max-w-sm">
                <h3 className="text-xl font-semibold text-gray-900">{f.title}</h3>
                <p className="mt-2 text-gray-600">{f.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};
