const HowtoUse = () => {
  return (
    <section className="py-20 bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900">
            How It Works
          </h2>
          <p className="mt-4 text-lg text-gray-600 max-w-2xl mx-auto">
            Getting started with AiRec is quick and effortless — here’s the
            journey.
          </p>
        </div>

        <div className="grid gap-12 md:grid-cols-3">
          {/* Step 1 */}
          <div className="text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-xl">
              1
            </div>
            <h3 className="mt-6 text-xl font-semibold text-gray-900">
              Sign Up
            </h3>
            <p className="mt-2 text-gray-600">
              Create your free account in just a few clicks.
            </p>
          </div>

          {/* Step 2 */}
          <div className="text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-xl">
              2
            </div>
            <h3 className="mt-6 text-xl font-semibold text-gray-900">
              Customize
            </h3>
            <p className="mt-2 text-gray-600">
              Set your preferences so AiRec knows exactly what to recommend.
            </p>
          </div>

          {/* Step 3 */}
          <div className="text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-xl">
              3
            </div>
            <h3 className="mt-6 text-xl font-semibold text-gray-900">
              Get Insights
            </h3>
            <p className="mt-2 text-gray-600">
              Receive tailored recommendations instantly and start making
              smarter decisions.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HowtoUse;
