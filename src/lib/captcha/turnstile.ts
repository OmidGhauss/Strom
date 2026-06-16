export async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;

  // Kein Secret → Dev/Test-Bypass
  if (!secret) return true;

  let response: Response;
  try {
    response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
    });
  } catch {
    return false;
  }

  if (!response.ok) return false;

  const result = (await response.json()) as { success: boolean };
  return result.success === true;
}
