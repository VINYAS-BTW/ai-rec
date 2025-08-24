import React, { useState } from "react";
import {
  PaperAirplaneIcon,
  MicrophoneIcon,
  PhotoIcon,
  UserCircleIcon,
  SparklesIcon,
  LightBulbIcon,
  ChatBubbleLeftRightIcon,
  CodeBracketIcon,
} from "@heroicons/react/24/outline";

export default function Hero() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleSend = () => {
    if (!input.trim()) return;

    const userMessage = { type: "user", text: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    // Simulate AI response after 2s
    setTimeout(() => {
      const aiMessage = {
        type: "ai",
        text: `Maga, still under construction , ill recommend u once my boss activates me `,
      };
      setMessages((prev) => [...prev, aiMessage]);
      setLoading(false);
    }, 1500);
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-800">
      {/* Header */}
      <div className="flex justify-between items-center px-6 py-4 bg-white shadow-md">
        <p className="text-2xl font-bold text-indigo-600">AiRec</p>
        <UserCircleIcon className="w-10 h-10 text-indigo-600" />
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col items-center overflow-y-auto px-4">
        {messages.length === 0 ? (
          <>
            {/* Greeting */}
            <div className="text-center mt-10">
              <p className="text-3xl font-semibold mb-2 text-gray-700">
                <span className="text-indigo-600">Hello User...</span>
              </p>
              <p className="text-lg text-gray-500">How can I help you today?</p>
            </div>

            {/* Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mt-10 max-w-5xl w-full">
              <Card
                icon={<SparklesIcon className="w-6 h-6 text-indigo-600" />}
                text="Suggest beautiful places to see on an upcoming road trip"
              />
              <Card
                icon={<LightBulbIcon className="w-6 h-6 text-indigo-600" />}
                text="Briefly summarize this concept: urban planning"
              />
              <Card
                icon={
                  <ChatBubbleLeftRightIcon className="w-6 h-6 text-indigo-600" />
                }
                text="Brainstorm team bonding activities for our work retreat"
              />
              <Card
                icon={<CodeBracketIcon className="w-6 h-6 text-indigo-600" />}
                text="Improve the readability of the following code"
              />
            </div>
          </>
        ) : (
          <div className="w-full max-w-3xl mt-6 space-y-6">
            {messages.map((msg, index) => (
              <div key={index} className="flex items-start gap-3">
                {msg.type === "user" ? (
                  <>
                    <UserCircleIcon className="w-10 h-10 text-indigo-600" />
                    <p className="bg-indigo-50 px-4 py-3 rounded-xl shadow text-gray-800">
                      {msg.text}
                    </p>
                  </>
                ) : (
                  <>
                    <SparklesIcon className="w-10 h-10 text-indigo-600" />
                    <div className="bg-white px-4 py-3 rounded-xl shadow w-full">
                      <p dangerouslySetInnerHTML={{ __html: msg.text }}></p>
                    </div>
                  </>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex items-center gap-2 text-indigo-600">
                <span className="w-2 h-2 bg-indigo-600 rounded-full animate-bounce"></span>
                <span className="w-2 h-2 bg-indigo-600 rounded-full animate-bounce delay-150"></span>
                <span className="w-2 h-2 bg-indigo-600 rounded-full animate-bounce delay-300"></span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input Bar */}
      <div className=" p-4 shadow-lg">
        <div className="flex items-center gap-3 max-w-4xl mx-auto bg-gray-100 rounded-full px-4 py-4 shadow-2xl border-neutral-900 border-1">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Enter a prompt here"
            className="flex-1 bg-transparent outline-none text-gray-700 px-2"
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
          />
          <PhotoIcon className="w-6 h-6 text-gray-500 hover:text-indigo-600 cursor-pointer" />
          <MicrophoneIcon className="w-6 h-6 text-gray-500 hover:text-indigo-600 cursor-pointer " />
          <PaperAirplaneIcon
            onClick={handleSend}
            className="w-6 h-6 text-indigo-600 cursor-pointer transform rotate-290 hover:scale-110 transition "
          />
        </div>
        <p className="text-center text-xs text-gray-500 mt-2">
          AI may display inaccurate info, so double-check responses.
        </p>
      </div>
    </div>
  );
}

/* Card Component */
function Card({ icon, text }) {
  return (
    <div className="bg-white rounded-xl shadow hover:shadow-md p-4 flex flex-col justify-between transition cursor-pointer">
      <p className="text-sm text-gray-600 mb-3">{text}</p>
      <div className="flex justify-end">{icon}</div>
    </div>
  );
}
