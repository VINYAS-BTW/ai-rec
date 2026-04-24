import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

console.log("🔄 Redis connecting to:", REDIS_URL);

export const redis = new Redis(REDIS_URL, {
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    console.log(
      `⏳ Redis reconnecting attempt ${times}... (delay: ${delay}ms)`,
    );
    return delay;
  },
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  connectTimeout: 10000,
});

redis.on("connect", () => {
  console.log("✅ Redis connected");
});

redis.on("error", (err) => {
  console.warn("⚠️ Redis error (non-fatal):", err.message);
});

redis.on("reconnecting", () => {
  console.log("🔄 Redis reconnecting...");
});
