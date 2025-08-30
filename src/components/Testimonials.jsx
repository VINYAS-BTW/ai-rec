"use client";
import { motion } from "framer-motion";

const testimonials = [
  {
    text: "AiRec completely transformed the way we make decisions. The insights are spot-on and save us hours every week.",
    name: "Priya Sharma",
    role: "Product Manager, TechNova",
    bg: "bg-indigo-50",
    span: "md:col-span-2 md:row-span-1",
  },
  {
    text: "The interface is so intuitive, my team adopted it instantly.",
    name: "Arjun Mehta",
    role: "Founder, StartUpHub",
    bg: "bg-gray-50",
  },
  {
    text: "We’ve seen a 30% boost in efficiency since integrating AiRec into our workflow.",
    name: "Neha Kapoor",
    role: "Operations Lead, FinEdge",
    bg: "bg-indigo-100",
    span: "md:row-span-2",
  },
  {
    text: "The recommendations feel like they were made just for me.",
    name: "Ravi Iyer",
    role: "Freelancer",
    bg: "bg-gray-50",
  },
  {
    text: "AiRec has become an essential part of our decision-making process. It’s like having a data scientist on call 24/7.",
    name: "Ananya Rao",
    role: "CEO, BrightPath",
    bg: "bg-indigo-50",
    span: "md:col-span-2",
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

const Testimonials = () => {
  return (
    <section className="py-20 bg-white overflow-x-hidden">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <motion.div
          className="text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900">
            What Our Clients Say
          </h2>
          <p className="mt-4 text-lg text-gray-600 max-w-2xl mx-auto">
            Real stories from people who’ve experienced the difference.
          </p>
        </motion.div>

        <motion.div
          className="grid gap-6 md:grid-cols-4 auto-rows-[200px]"
          variants={containerVariants}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.2 }}
        >
          {testimonials.map((t, i) => (
            <motion.div
              key={i}
              variants={cardVariants}
              whileHover={{
                scale: 1.03,
                boxShadow: "0 12px 30px rgba(0,0,0,0.12)",
              }}
              transition={{ type: "spring", stiffness: 200, damping: 15 }}
              className={`${t.bg} p-6 rounded-xl shadow-sm flex flex-col justify-between ${t.span || ""} cursor-pointer`}
            >
              <p className="text-gray-700 text-lg">{t.text}</p>
              <div className="mt-4">
                <h4 className="font-semibold text-gray-900">{t.name}</h4>
                <p className="text-gray-500 text-sm">{t.role}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
};

export default Testimonials;
