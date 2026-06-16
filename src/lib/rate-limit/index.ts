import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let ratelimit: Ratelimit | null = null;

function getRatelimit(): Ratelimit | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  if (!ratelimit) {
    ratelimit = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.fixedWindow(5, "10 m"),
    });
  }
  return ratelimit;
}

export async function checkRateLimit(
  identifier: string,
): Promise<{ success: boolean; retryAfter: number }> {
  const rl = getRatelimit();
  if (!rl) return { success: true, retryAfter: 0 };

  const result = await rl.limit(identifier);
  return {
    success: result.success,
    retryAfter: result.success ? 0 : Math.ceil((result.reset - Date.now()) / 1000),
  };
}
