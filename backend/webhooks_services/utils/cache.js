import { redis } from "./redisClient.js";
import crypto from "crypto";

function generateKey(body) {
  return (
    "rec:" + crypto.createHash("md5").update(JSON.stringify(body)).digest("hex")
  );
}

export async function cacheGetOrSet(body, cb, ttl = 60) {
  const key = generateKey(body);

  try {
    const cached = await redis.get(key);

    if (cached) {
      console.log("⚡ CACHE HIT");
      return JSON.parse(cached);
    }
  } catch (err) {
    console.warn("⚠️ Cache GET failed, proceeding without cache:", err.message);
  }

  console.log("❌ CACHE MISS");

  const freshData = await cb();

  // Try to cache the result, but don't fail if Redis is down
  if (freshData) {
    try {
      await redis.set(key, JSON.stringify(freshData), "EX", ttl);
    } catch (err) {
      console.warn(
        "⚠️ Cache SET failed, continuing without cache:",
        err.message,
      );
    }
  }

  return freshData;
}
