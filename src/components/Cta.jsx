"use client";
import { useNavigate } from "react-router-dom";

const Cta = () => {
  const navigate = useNavigate();

  return (
    <section className="py-20 bg-indigo-600 text-white text-center">
      <div className="max-w-3xl mx-auto px-6">
        <h2 className="text-3xl md:text-4xl font-bold">
          Ready to Make Smarter Decisions?
        </h2>
        <p className="mt-4 text-lg text-indigo-100">
          Join thousands of users who trust AiRec for accurate, personalized recommendations.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
          <button
            onClick={() => navigate("/dashboard")}
            className="bg-white text-indigo-600 px-6 py-3 rounded-full font-medium hover:bg-indigo-100 transition-colors duration-200"
          >
            Get Started Free
          </button>

          <button className="border border-white px-6 py-3 rounded-full font-medium hover:bg-indigo-500 transition-colors duration-200">
            Learn More
          </button>
        </div>

        <p className="mt-4 text-sm text-indigo-200">No credit card required</p>
      </div>
    </section>
  );
};

export default Cta;
