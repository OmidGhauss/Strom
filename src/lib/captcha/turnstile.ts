export async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;

  // Dev/Demo-Bypass: kein TURNSTILE_SECRET_KEY gesetzt → Verifikation übersprungen.
  // TECHNISCHE SCHULD: Für Production muss TURNSTILE_SECRET_KEY in den
  // Deployment-Umgebungsvariablen gesetzt sein. Ohne diesen Key ist jeder
  // Token gültig, unabhängig vom Client.
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
