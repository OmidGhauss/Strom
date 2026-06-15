// Next.js 16: `middleware.ts` ist deprecated und heißt jetzt `proxy.ts`.
// Die exportierte Funktion heißt `proxy` (nicht mehr `middleware`).
// Docs: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md

import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Optimistischer Auth-Check: prüft ob eine Supabase-Session im Cookie vorhanden ist.
// Lehnt unauthentifizierte Requests früh ab, bevor sie den Route Handler erreichen.
// Ist NICHT die einzige Sicherheitsschicht — requireAuth() in jedem Handler ist Pflicht.
//
// /api/public/* ist explizit ausgenommen (kein Auth erforderlich für das öffentliche Formular).
export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Nur /api/* Routen prüfen
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Öffentliche Routen nicht prüfen
  if (pathname.startsWith("/api/public/")) {
    return NextResponse.next();
  }

  // In Proxy: cookies aus NextRequest lesen (nicht aus next/headers).
  // createServerClient braucht get/set/delete auf dem Response-Cookie-Store.
  const response = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json(
      { error: "Nicht authentifiziert", code: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  return response;
}

export const config = {
  matcher: ["/api/:path*"],
};
